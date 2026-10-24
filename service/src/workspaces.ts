import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { canCreateWorkspace, requireAuth, type AuthVars } from './auth';
import { db } from './db';

export const workspaces = new Hono<{ Variables: AuthVars }>();

const requireOwner = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
	if (c.var.role !== 'owner') return c.json({ error: 'forbidden', message: 'Só o dono do workspace pode fazer isso.' }, 403);
	await next();
});

const workspaceName = z.object({ name: z.string().trim().min(1).max(60) });

/** New workspace owned by the user (ALLOWED_GITHUB_LOGINS only); becomes the session's active one. */
workspaces.post('/workspaces', requireAuth, async (c) => {
	const identity = await db.identity.findFirst({ where: { userId: c.var.userId, provider: 'github' } });
	if (!canCreateWorkspace(identity?.login)) return c.json({ error: 'forbidden', message: 'Seu login não pode criar workspaces.' }, 403);
	const body = workspaceName.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Nome inválido.' }, 400);
	const workspace = await db.workspace.create({ data: { name: body.data.name, members: { create: { userId: c.var.userId } } } });
	await db.session.update({ where: { tokenHash: c.var.tokenHash }, data: { workspaceId: workspace.id } });
	return c.json({ id: workspace.id }, 201);
});

workspaces.patch('/workspace', requireAuth, requireOwner, async (c) => {
	const body = workspaceName.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Nome inválido.' }, 400);
	await db.workspace.update({ where: { id: c.var.workspaceId }, data: { name: body.data.name } });
	return c.body(null, 204);
});

/** Active workspace of this session (the switcher); only one the user is a member of. */
workspaces.post('/workspaces/:id/switch', requireAuth, async (c) => {
	const member = await db.member.findUnique({ where: { workspaceId_userId: { workspaceId: c.req.param('id'), userId: c.var.userId } } });
	if (!member) return c.json({ error: 'not_found' }, 404);
	await db.session.update({ where: { tokenHash: c.var.tokenHash }, data: { workspaceId: member.workspaceId } });
	return c.body(null, 204);
});

workspaces.get('/members', requireAuth, async (c) => {
	const [members, invites] = await Promise.all([
		db.member.findMany({
			where: { workspaceId: c.var.workspaceId },
			include: { user: { include: { identities: { where: { provider: 'github' }, take: 1 } } } },
		}),
		db.invite.findMany({ where: { workspaceId: c.var.workspaceId }, orderBy: { createdAt: 'asc' } }),
	]);
	return c.json({
		members: members.map((m) => ({
			userId: m.userId,
			name: m.user.name,
			avatarUrl: m.user.avatarUrl,
			login: m.user.identities[0]?.login ?? null,
			role: m.role,
		})),
		invites: invites.map(({ id, login, createdAt }) => ({ id, login, createdAt })),
	});
});

// GitHub login rules: alphanumerics and single hyphens, up to 39 chars.
const invite = z.object({
	login: z
		.string()
		.trim()
		.regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)
		.transform((s) => s.toLowerCase()),
});

workspaces.post('/invites', requireAuth, requireOwner, async (c) => {
	const body = invite.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Login do GitHub inválido.' }, 400);
	const { workspaceId } = c.var;
	const { login } = body.data;
	const already = await db.member.count({
		where: { workspaceId, user: { identities: { some: { provider: 'github', login: { equals: login, mode: 'insensitive' } } } } },
	});
	if (already) return c.json({ error: 'invalid_invite', message: 'Já é membro do workspace.' }, 400);
	const created = await db.invite.createMany({ data: { workspaceId, login }, skipDuplicates: true });
	if (!created.count) return c.json({ error: 'invalid_invite', message: 'Convite já enviado.' }, 400);
	return c.body(null, 201);
});

workspaces.delete('/invites/:id', requireAuth, requireOwner, async (c) => {
	const { count } = await db.invite.deleteMany({ where: { id: c.req.param('id'), workspaceId: c.var.workspaceId } });
	return count ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});

// Removing revokes access right away: requireAuth checks the membership on every request.
workspaces.delete('/members/:userId', requireAuth, requireOwner, async (c) => {
	const { count } = await db.member.deleteMany({ where: { workspaceId: c.var.workspaceId, userId: c.req.param('userId'), role: 'member' } });
	return count ? c.body(null, 204) : c.json({ error: 'not_found', message: 'Membro não encontrado (o dono não pode ser removido).' }, 404);
});
