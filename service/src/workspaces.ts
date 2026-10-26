import { Hono } from 'hono';
import { z } from 'zod';
import { canCreateWorkspace, requireAuth, requireOwner, requireUser, type AuthVars } from './auth';
import { db } from './db';
import { env } from './env';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const workspaces = new Hono<{ Variables: AuthVars }>();

const workspaceName = z.object({ name: z.string().trim().min(1).max(60) });

/** New workspace owned by the user (only ALLOWED_GITHUB_LOGINS when set); becomes the session's active one. */
workspaces.post('/workspaces', requireUser, async (c) => {
	const identity = await db.identity.findFirst({ where: { userId: c.var.userId, provider: 'github' } });
	if (!canCreateWorkspace(identity?.login)) return c.json({ error: 'forbidden', message: 'Seu login não pode criar workspaces.' }, 403);
	// The daily cost cap is per workspace: without this, N workspaces multiply it.
	// ponytail: count then create; simultaneous requests can pass the limit by one.
	const owned = await db.member.count({ where: { userId: c.var.userId, role: 'owner' } });
	if (owned >= env.MAX_WORKSPACES_PER_USER)
		return c.json({ error: 'forbidden', message: `Limite de ${env.MAX_WORKSPACES_PER_USER} workspaces por conta.` }, 403);
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
		// Codes only for the owner: a member could hand them out.
		c.var.role === 'owner'
			? db.invite.findMany({ where: { workspaceId: c.var.workspaceId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } })
			: [],
	]);
	return c.json({
		members: members.map((m) => ({
			userId: m.userId,
			name: m.user.name,
			avatarUrl: m.user.avatarUrl,
			login: m.user.identities[0]?.login ?? null,
			role: m.role,
		})),
		invites: invites.map(({ id, code, expiresAt }) => ({ id, code, expiresAt })),
	});
});

/** New invite code (link: app/invite/<code>), reusable for 7 days or until revoked. 72 random bits: short enough to type. */
workspaces.post('/invites', requireAuth, requireOwner, async (c) => {
	const code = Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString('base64url');
	await db.invite.deleteMany({ where: { workspaceId: c.var.workspaceId, expiresAt: { lt: new Date() } } });
	const invite = await db.invite.create({ data: { workspaceId: c.var.workspaceId, code, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
	return c.json({ id: invite.id, code, expiresAt: invite.expiresAt }, 201);
});

/** Joins the invite's workspace as member (no-op if already in it) and makes it the session's active one. */
workspaces.post('/invites/:code/accept', requireUser, async (c) => {
	const invite = await db.invite.findUnique({ where: { code: c.req.param('code') } });
	if (!invite || invite.expiresAt < new Date()) return c.json({ error: 'not_found', message: 'Convite inválido ou expirado.' }, 404);
	await db.member.createMany({ data: { workspaceId: invite.workspaceId, userId: c.var.userId, role: 'member' }, skipDuplicates: true });
	await db.session.update({ where: { tokenHash: c.var.tokenHash }, data: { workspaceId: invite.workspaceId } });
	return c.json({ workspaceId: invite.workspaceId });
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
