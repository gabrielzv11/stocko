import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { db } from './db';
import { env } from './env';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * DAY_MS;
const STATE_TTL_MS = 10 * 60 * 1000;

export type AuthVars = { userId: string; workspaceId: string; role: string; tokenHash: string };

const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

// Single entry point for auth; a host JWT branch can be added here later.
export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
	const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
	if (!token) return c.json({ error: 'unauthorized' }, 401);

	const tokenHash = sha256(token);
	const session = await db.session.findUnique({
		where: { tokenHash },
		include: { user: { include: { memberships: { orderBy: { workspace: { createdAt: 'asc' } } } } } },
	});
	// Active workspace of the session; removed from it (or none picked) → the first one still theirs.
	const memberships = session?.user.memberships ?? [];
	const membership = memberships.find((m) => m.workspaceId === session?.workspaceId) ?? memberships[0];
	if (!session || session.expiresAt < new Date() || !membership) return c.json({ error: 'unauthorized' }, 401);

	// Sliding TTL; refresh at most once a day to avoid a write per request.
	if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - DAY_MS) {
		await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
	}

	c.set('userId', session.userId);
	c.set('workspaceId', membership.workspaceId);
	c.set('role', membership.role);
	c.set('tokenHash', tokenHash);
	await next();
});

export const auth = new Hono<{ Variables: AuthVars }>();

auth.get('/auth/github/login', async (c) => {
	const state = randomToken();
	await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
	await db.oAuthState.create({ data: { state, kind: 'login', expiresAt: new Date(Date.now() + STATE_TTL_MS) } });

	const url = new URL('https://github.com/login/oauth/authorize');
	url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	url.searchParams.set('state', state);
	return c.redirect(url.toString());
});

auth.get('/auth/github/callback', async (c) => {
	const fail = (error: string) => c.redirect(`${env.FRONTEND_URL}/login#error=${error}`);
	const { code, state } = c.req.query();
	if (!code || !state) return fail('invalid_request');

	// Deleting consumes the state: single use.
	const { count } = await db.oAuthState.deleteMany({ where: { state, kind: 'login', expiresAt: { gt: new Date() } } });
	if (!count) return fail('invalid_state');

	const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
	});
	const { access_token } = (await tokenRes.json()) as { access_token?: string };
	if (!access_token) return fail('github_error');

	const headers = { Authorization: `Bearer ${access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'stocko' };
	const userRes = await fetch('https://api.github.com/user', { headers });
	if (!userRes.ok) return fail('github_error');
	const gh = (await userRes.json()) as { id: number; login: string; name: string | null; avatar_url: string };

	const login = gh.login.toLowerCase();
	const profile = { name: gh.name ?? gh.login, avatarUrl: gh.avatar_url };
	const subject = String(gh.id);
	const identity = await db.identity.findUnique({ where: { provider_subject: { provider: 'github', subject } } });
	const invites = await db.invite.findMany({ where: { login }, orderBy: { createdAt: 'asc' } });
	// Allowlist, or vouched for by a workspace: pending invite or still a member of one they were invited to.
	const invitedMember = identity ? await db.member.count({ where: { userId: identity.userId, role: 'member' } }) : 0;
	if (!env.ALLOWED_GITHUB_LOGINS.includes(login) && !invites.length && !invitedMember) return fail('forbidden');

	const joined = invites.map((i) => ({ workspaceId: i.workspaceId, role: 'member' }));
	const userId = identity
		? (await db.identity.update({ where: { id: identity.id }, data: { login: gh.login, user: { update: profile } } }))
				.userId
		: (
				await db.user.create({
					data: {
						...profile,
						identities: { create: { provider: 'github', subject, login: gh.login } },
						// Invited: joins those workspaces. Otherwise gets their own.
						memberships: joined.length ? { create: joined } : { create: { workspace: { create: { name: gh.login } } } },
					},
				})
			).id;
	if (identity && joined.length) await db.member.createMany({ data: joined.map((j) => ({ ...j, userId })), skipDuplicates: true });
	if (invites.length) await db.invite.deleteMany({ where: { id: { in: invites.map((i) => i.id) } } });
	// Removed from every workspace they joined, now allowlisted: gets their own instead of a dead session.
	if (!(await db.member.count({ where: { userId } })))
		await db.member.create({ data: { user: { connect: { id: userId } }, workspace: { create: { name: gh.login } } } });

	// Links every App installation this GitHub user can access to the workspace they own (none when they only joined by invite).
	// The installation_id GitHub appends to the setup URL is spoofable, so the user's own token is the source of truth.
	// Ones owned by another workspace are skipped.
	// ponytail: first 100 installations only; paginate if a user ever has more.
	const owned = await db.member.findFirst({ where: { userId, role: 'owner' } });
	const instRes = owned && (await fetch('https://api.github.com/user/installations?per_page=100', { headers }));
	if (owned && instRes?.ok) {
		const { installations } = (await instRes.json()) as { installations: { id: number; account: { login: string } }[] };
		await db.installation.createMany({
			data: installations.map((i) => ({ workspaceId: owned.workspaceId, githubInstallationId: BigInt(i.id), accountLogin: i.account.login })),
			skipDuplicates: true,
		});
	}

	const token = randomToken();
	await db.session.create({
		// Just accepted an invite → lands in that workspace.
		data: { tokenHash: sha256(token), userId, workspaceId: invites[0]?.workspaceId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
	});
	// Fragment never reaches servers or logs.
	return c.redirect(`${env.FRONTEND_URL}/login#token=${token}`);
});

// GitHub install page (pick account + repos). The App's Setup URL points back to /auth/github/login,
// which re-runs OAuth and links the installation above.
auth.get('/github/install', (c) => c.redirect(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`));

auth.post('/auth/logout', requireAuth, async (c) => {
	await db.session.delete({ where: { tokenHash: c.var.tokenHash } });
	return c.body(null, 204);
});

auth.get('/me', requireAuth, async (c) => {
	const [user, installations] = await Promise.all([
		db.user.findUniqueOrThrow({
			where: { id: c.var.userId },
			include: {
				identities: { where: { provider: 'github' }, take: 1 },
				memberships: { orderBy: { workspace: { createdAt: 'asc' } }, include: { workspace: { select: { name: true } } } },
			},
		}),
		db.installation.count({ where: { workspaceId: c.var.workspaceId } }),
	]);
	return c.json({
		id: user.id,
		name: user.name,
		avatarUrl: user.avatarUrl,
		login: user.identities[0]?.login ?? null,
		workspaceId: c.var.workspaceId,
		role: c.var.role,
		workspaces: user.memberships.map((m) => ({ id: m.workspaceId, name: m.workspace.name, role: m.role })),
		hasInstallation: installations > 0,
	});
});
