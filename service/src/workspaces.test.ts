import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { auth } = await import('./auth');
const { db } = await import('./db');
const { workspaces } = await import('./workspaces');
const { env } = await import('./env');

const suffix = Date.now().toString(36);

/** Runs the OAuth callback with GitHub mocked as `login`; returns the session token and where it redirected. */
async function signIn(login: string, githubId: number, opts: { kind?: string; workspaceId?: string; installations?: number[] } = {}) {
	const state = crypto.randomUUID();
	await db.oAuthState.create({ data: { state, kind: opts.kind ?? 'login', workspaceId: opts.workspaceId, expiresAt: new Date(Date.now() + 60_000) } });
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string) => {
		if (url.includes('/login/oauth/access_token')) return Response.json({ access_token: 'gho_test' });
		if (url.endsWith('/user')) return Response.json({ id: githubId, login, name: null, avatar_url: '' });
		return Response.json({ installations: (opts.installations ?? []).map((id) => ({ id, account: { login: 'acme' } })) });
	}) as typeof fetch;
	try {
		const res = await auth.request(`/auth/github/callback?code=c&state=${state}`);
		const location = new URL(res.headers.get('Location')!);
		return { token: location.hash.match(/token=(.+)/)?.[1], location };
	} finally {
		globalThis.fetch = realFetch;
	}
}

const call = (token: string, path: string, init: RequestInit = {}) =>
	workspaces.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
const post = (token: string, path: string, body?: unknown) => call(token, path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
type Me = { workspaceId: string | null; role: string | null; workspaces: { id: string }[]; canCreateWorkspace: boolean };
const me = async (token: string) => (await (await auth.request('/me', { headers: { Authorization: `Bearer ${token}` } })).json()) as Me;

/** Runs `fn` with ALLOWED_GITHUB_LOGINS set to `logins`, restoring it after. */
async function withAllowlist(logins: string[], fn: () => Promise<void>) {
	const saved = env.ALLOWED_GITHUB_LOGINS.splice(0, Infinity, ...logins);
	try {
		await fn();
	} finally {
		env.ALLOWED_GITHUB_LOGINS.splice(0, Infinity, ...saved);
	}
}

test('workspaces: open sign-in lands without workspace; invite code joins; owner-only management; removal', async () => {
	const githubId = Number(Date.now() % 1e9);
	const logins = [`owner-${suffix}`, `invitee-${suffix}`];

	try {
		await withAllowlist([], async () => {
			// Any GitHub account signs in, with no workspace: /me works, workspace routes ask for onboarding.
			const { token: ownerToken } = await signIn(logins[0]!, githubId);
			const { token } = await signIn(logins[1]!, githubId + 1);
			expect(await me(token!)).toMatchObject({ workspaceId: null, role: null, workspaces: [], canCreateWorkspace: true });
			expect((await call(token!, '/members')).status).toBe(403);

			const { id: team } = (await (await post(ownerToken!, '/workspaces', { name: 'Team' })).json()) as { id: string };
			const { code } = (await (await post(ownerToken!, '/invites')).json()) as { code: string };
			expect((await post(token!, '/invites/nope/accept')).status).toBe(404);

			// Invite: joins as member and lands in it; accepting again is a no-op.
			expect((await post(token!, `/invites/${code}/accept`)).status).toBe(200);
			expect((await post(token!, `/invites/${code}/accept`)).status).toBe(200);
			expect(await me(token!)).toMatchObject({ workspaceId: team, role: 'member', workspaces: [{ id: team }] });

			// Members can't manage; the owner can't be removed.
			expect((await post(token!, '/invites')).status).toBe(403);
			const list = (await (await call(ownerToken!, '/members')).json()) as { members: { userId: string; login: string | null; role: string }[]; invites: { code: string }[] };
			expect(list.invites).toEqual([expect.objectContaining({ code })]);
			const invitee = list.members.find((m) => m.login === logins[1])!;
			expect(invitee.role).toBe('member');
			const owner = list.members.find((m) => m.role === 'owner')!;
			expect((await call(ownerToken!, `/members/${owner.userId}`, { method: 'DELETE' })).status).toBe(404);

			// Can't switch into a workspace they aren't in.
			const other = await db.workspace.create({ data: { name: 'other' } });
			expect((await post(token!, `/workspaces/${other.id}/switch`)).status).toBe(404);
			await db.workspace.delete({ where: { id: other.id } });

			// Removed → back to onboarding (session still valid). Revoked or expired codes don't work.
			expect((await call(ownerToken!, `/members/${invitee.userId}`, { method: 'DELETE' })).status).toBe(204);
			expect(await me(token!)).toMatchObject({ workspaceId: null, workspaces: [] });
			const invite = await db.invite.findUniqueOrThrow({ where: { code } });
			await db.invite.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
			expect((await post(token!, `/invites/${code}/accept`)).status).toBe(404);
			expect((await call(ownerToken!, `/invites/${invite.id}`, { method: 'DELETE' })).status).toBe(204);
		});
	} finally {
		const users = await db.identity.findMany({ where: { login: { in: logins } } });
		await db.workspace.deleteMany({ where: { members: { some: { userId: { in: users.map((u) => u.userId) } } } } });
		await db.user.deleteMany({ where: { id: { in: users.map((u) => u.userId) } } });
	}
});

test('workspaces: ALLOWED_GITHUB_LOGINS limits creation; rename; one installation links to N workspaces, owner only', async () => {
	const login = `founder-${suffix}`;
	const githubId = Number(Date.now() % 1e9) + 7;
	const installationId = Date.now();
	let userId = '';

	try {
		await withAllowlist([login], async () => {
			// Sign-in alone links nothing (no workspace yet).
			const { token } = await signIn(login, githubId, { installations: [installationId] });
			userId = (await db.identity.findFirstOrThrow({ where: { login } })).userId;
			expect(await db.installation.count({ where: { githubInstallationId: BigInt(installationId) } })).toBe(0);

			expect((await post(token!, '/workspaces', { name: ' ' })).status).toBe(400);
			const ids: string[] = [];
			for (const name of ['A', 'B']) ids.push(((await (await post(token!, '/workspaces', { name })).json()) as { id: string }).id);
			expect((await call(token!, '/workspace', { method: 'PATCH', body: JSON.stringify({ name: 'B2' }) })).status).toBe(204);
			expect((await db.workspace.findUniqueOrThrow({ where: { id: ids[1] } })).name).toBe('B2');

			// Connect links the same installation to each workspace that asks and goes to GitHub's install page.
			for (const workspaceId of ids) {
				const { location } = await signIn(login, githubId, { kind: 'connect', workspaceId, installations: [installationId] });
				expect(location.hostname).toBe('github.com');
			}
			expect(await db.installation.count({ where: { githubInstallationId: BigInt(installationId) } })).toBe(2);

			// A workspace they don't own gets nothing.
			const foreign = await db.workspace.create({ data: { name: 'foreign' } });
			await signIn(login, githubId, { kind: 'connect', workspaceId: foreign.id, installations: [installationId] });
			expect(await db.installation.count({ where: { workspaceId: foreign.id } })).toBe(0);
			await db.workspace.delete({ where: { id: foreign.id } });

			// Not listed: can sign in, can't create.
			await withAllowlist(['someone-else'], async () => {
				expect((await me(token!)).canCreateWorkspace).toBe(false);
				expect((await post(token!, '/workspaces', { name: 'C' })).status).toBe(403);
			});
		});
	} finally {
		await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
		if (userId) await db.user.delete({ where: { id: userId } });
	}
});
