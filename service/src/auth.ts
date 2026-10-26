import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { installationOctokit } from './client';
import { db } from './db';
import { env } from './env';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * DAY_MS;
const STATE_TTL_MS = 10 * 60 * 1000;

export type AuthVars = { userId: string; workspaceId: string; role: string; tokenHash: string };

// Workspace that asked to connect the App; survives the trip through GitHub's install page back to the Setup URL.
const INSTALL_COOKIE = 'stocko_install_ws';
// GitHub's page to install the App on an account and pick repos.
const installPage = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;

/** Who may create workspaces: everyone, or only ALLOWED_GITHUB_LOGINS when set. Anyone can join one by invite. */
export const canCreateWorkspace = (login: string | null | undefined) =>
	!env.ALLOWED_GITHUB_LOGINS.length || (!!login && env.ALLOWED_GITHUB_LOGINS.includes(login.toLowerCase()));

/**
 * The GitHub user can read every repo of the installation. /user/installations lists any installation the user reaches
 * even one repo of, but the workspace lists repos with the installation's own token: linking a partial one would hand
 * the workspace private repos the user can't read. Both counts come from GitHub; the user's is a subset of the App's.
 * ponytail: checked at link time only; repos added to the installation later aren't re-checked.
 */
export async function seesWholeInstallation(installationId: number, headers: Record<string, string>) {
	try {
		const res = await fetch(`https://api.github.com/user/installations/${installationId}/repositories?per_page=1`, { headers });
		if (!res.ok) return false;
		const { total_count: mine } = (await res.json()) as { total_count: number };
		const { data } = await installationOctokit(installationId).rest.apps.listReposAccessibleToInstallation({ per_page: 1 });
		return mine === data.total_count;
	} catch {
		return false;
	}
}

export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

/** Valid session → its user and active workspace membership (none yet = onboarding). */
async function sessionOf(c: Context) {
	const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
	if (!token) return null;

	const tokenHash = sha256(token);
	const session = await db.session.findUnique({
		where: { tokenHash },
		include: { user: { include: { memberships: { orderBy: { workspace: { createdAt: 'asc' } } } } } },
	});
	if (!session || session.expiresAt < new Date()) return null;

	// Sliding TTL; refresh at most once a day to avoid a write per request.
	if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - DAY_MS) {
		await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
	}
	// Active workspace of the session; removed from it (or none picked) → the first one still theirs.
	const memberships = session.user.memberships;
	const membership = memberships.find((m) => m.workspaceId === session.workspaceId) ?? memberships[0];
	return { userId: session.userId, tokenHash, membership };
}

/** Signed in, with or without a workspace: /me and the onboarding (create a workspace or accept an invite). */
export const requireUser = createMiddleware<{ Variables: Partial<AuthVars> & Pick<AuthVars, 'userId' | 'tokenHash'> }>(async (c, next) => {
	const s = await sessionOf(c);
	if (!s) return c.json({ error: 'unauthorized' }, 401);
	c.set('userId', s.userId);
	c.set('tokenHash', s.tokenHash);
	if (s.membership) {
		c.set('workspaceId', s.membership.workspaceId);
		c.set('role', s.membership.role);
	}
	await next();
});

// Single entry point for auth; a host JWT branch can be added here later.
export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
	const s = await sessionOf(c);
	if (!s) return c.json({ error: 'unauthorized' }, 401);
	if (!s.membership) return c.json({ error: 'no_workspace', message: 'Crie um workspace ou entre por convite.' }, 403);
	c.set('userId', s.userId);
	c.set('workspaceId', s.membership.workspaceId);
	c.set('role', s.membership.role);
	c.set('tokenHash', s.tokenHash);
	await next();
});

export const forbidden = (c: Context) => c.json({ error: 'forbidden', message: 'Só o dono do workspace pode fazer isso.' }, 403);

/** After requireAuth. Owner only: workspace config, credentials (API auth, Jira) and deletions. */
export const requireOwner = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
	if (c.var.role !== 'owner') return forbidden(c);
	await next();
});

export const auth = new Hono<{ Variables: AuthVars }>();

// Explicit callback on this host, else GitHub uses the App's first Callback URL (localhost in prod).
// Behind a proxy (Railway) the request arrives as http; X-Forwarded-Proto has the real scheme.
function callbackUrl(c: Context) {
	const callback = new URL('/auth/github/callback', c.req.url);
	callback.protocol = c.req.header('X-Forwarded-Proto') ?? callback.protocol;
	return callback;
}

async function authorize(c: Context, kind: 'login' | 'connect', workspaceId: string | undefined) {
	const state = randomToken();
	await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
	await db.oAuthState.create({ data: { state, kind, workspaceId, expiresAt: new Date(Date.now() + STATE_TTL_MS) } });

	const url = new URL('https://github.com/login/oauth/authorize');
	url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	url.searchParams.set('redirect_uri', callbackUrl(c).toString());
	url.searchParams.set('state', state);
	return c.redirect(url.toString());
}

// Also the App's Setup URL: after an install started by /github/install, the cookie says which workspace gets it.
auth.get('/auth/github/login', (c) => authorize(c, 'login', getCookie(c, INSTALL_COOKIE)));

auth.get('/auth/github/callback', async (c) => {
	const fail = (error: string) => c.redirect(`${env.FRONTEND_URL}/login#error=${error}`);
	const { code, state } = c.req.query();
	if (!code || !state) return fail('invalid_request');

	// Deleting consumes the state: single use.
	const saved = await db.oAuthState.delete({ where: { state } }).catch(() => null);
	if (!saved || saved.expiresAt < new Date() || !['login', 'connect'].includes(saved.kind)) return fail('invalid_state');

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

	// Any GitHub account signs in; with no workspace yet, the front shows the onboarding (create one or accept an invite).
	const profile = { name: gh.name ?? gh.login, avatarUrl: gh.avatar_url };
	const subject = String(gh.id);
	const identity = await db.identity.findUnique({ where: { provider_subject: { provider: 'github', subject } } });
	const userId = identity
		? (await db.identity.update({ where: { id: identity.id }, data: { login: gh.login, user: { update: profile } } }))
				.userId
		: (await db.user.create({ data: { ...profile, identities: { create: { provider: 'github', subject, login: gh.login } } } })).id;

	// Links every App installation this GitHub user can read in full to the workspace that asked (/github/install), if they own it.
	// The installation_id GitHub appends to the setup URL is spoofable, so the user's own token is the source of truth.
	// The same installation can serve N workspaces.
	// ponytail: first 100 installations only; paginate if a user ever has more.
	const target = saved.workspaceId
		? await db.member.findFirst({ where: { userId, role: 'owner', workspaceId: saved.workspaceId } })
		: null;
	const instRes = target && (await fetch('https://api.github.com/user/installations?per_page=100', { headers }));
	if (target && instRes?.ok) {
		const { installations } = (await instRes.json()) as { installations: { id: number; account: { login: string } }[] };
		const whole = await Promise.all(installations.map((i) => seesWholeInstallation(i.id, headers)));
		await db.installation.createMany({
			data: installations
				.filter((_, k) => whole[k])
				.map((i) => ({ workspaceId: target.workspaceId, githubInstallationId: BigInt(i.id), accountLogin: i.account.login })),
			skipDuplicates: true,
		});
	}

	// Connect: installations the user already had are linked; now GitHub's page to install on another account or pick repos.
	// The front already has a session, so no new one.
	if (saved.kind === 'connect') return c.redirect(installPage);

	deleteCookie(c, INSTALL_COOKIE, { path: '/' });
	const token = randomToken();
	await db.session.create({
		// Just linked an installation → lands in the workspace that got it.
		data: { tokenHash: sha256(token), userId, workspaceId: target?.workspaceId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
	});
	// Fragment never reaches servers or logs.
	return c.redirect(`${env.FRONTEND_URL}/login#token=${token}`);
});

// "Connect GitHub" for ?workspace=: OAuth links the installations the user already has, then GitHub's install page
// (pick account + repos), whose Setup URL comes back to /auth/github/login carrying the workspace in the cookie.
// The id isn't trusted: the callback only links to a workspace this GitHub user owns.
auth.get('/github/install', (c) => {
	const workspaceId = c.req.query('workspace');
	if (!workspaceId) return c.redirect(installPage);
	setCookie(c, INSTALL_COOKIE, workspaceId, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: callbackUrl(c).protocol === 'https:',
		maxAge: STATE_TTL_MS / 1000,
		path: '/',
	});
	return authorize(c, 'connect', workspaceId);
});

auth.post('/auth/logout', requireUser, async (c) => {
	await db.session.delete({ where: { tokenHash: c.var.tokenHash } });
	return c.body(null, 204);
});

// No workspace yet: workspaceId/role null, workspaces [] → onboarding.
auth.get('/me', requireUser, async (c) => {
	const [user, installations] = await Promise.all([
		db.user.findUniqueOrThrow({
			where: { id: c.var.userId },
			include: {
				identities: { where: { provider: 'github' }, take: 1 },
				memberships: { orderBy: { workspace: { createdAt: 'asc' } }, include: { workspace: { select: { name: true } } } },
			},
		}),
		c.var.workspaceId ? db.installation.count({ where: { workspaceId: c.var.workspaceId } }) : 0,
	]);
	return c.json({
		id: user.id,
		name: user.name,
		avatarUrl: user.avatarUrl,
		login: user.identities[0]?.login ?? null,
		workspaceId: c.var.workspaceId ?? null,
		role: c.var.role ?? null,
		workspaces: user.memberships.map((m) => ({ id: m.workspaceId, name: m.workspace.name, role: m.role })),
		hasInstallation: installations > 0,
		canCreateWorkspace: canCreateWorkspace(user.identities[0]?.login),
	});
});
