import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { auth, sha256 } = await import('./auth');
const { db } = await import('./db');
const { workspaces } = await import('./workspaces');
const { env } = await import('./env');

const suffix = Date.now().toString(36);

/** Runs the OAuth callback with GitHub mocked as `login`; returns the session token, or the error in the redirect. */
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
		const hash = location.hash;
		return { token: hash.match(/token=(.+)/)?.[1], error: hash.match(/error=(.+)/)?.[1], location };
	} finally {
		globalThis.fetch = realFetch;
	}
}

test('workspaces: invite lets a login in and joins it; owner-only management; switch and removal', async () => {
	const owner = await db.user.create({
		data: { name: 'owner', memberships: { create: { workspace: { create: { name: 'team' } } } } },
		include: { memberships: true },
	});
	const team = owner.memberships[0]!.workspaceId;
	const ownerToken = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(ownerToken), userId: owner.id, expiresAt: new Date(Date.now() + 60_000) } });
	const call = (token: string, path: string, init: RequestInit = {}) =>
		workspaces.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
	const me = async (token: string) => (await (await auth.request('/me', { headers: { Authorization: `Bearer ${token}` } })).json()) as { workspaceId: string; role: string; workspaces: { id: string }[] };
	const invitee = `invitee-${suffix}`;
	const inviteeGithubId = Number(Date.now() % 1e9);
	let inviteeUserId = '';

	try {
		// Not in ALLOWED_GITHUB_LOGINS and not invited.
		expect(await signIn(`stranger-${suffix}`, inviteeGithubId + 1)).toMatchObject({ error: 'forbidden' });

		expect((await call(ownerToken, '/invites', { method: 'POST', body: JSON.stringify({ login: 'not a login' }) })).status).toBe(400);
		expect((await call(ownerToken, '/invites', { method: 'POST', body: JSON.stringify({ login: invitee.toUpperCase() }) })).status).toBe(201);
		expect((await call(ownerToken, '/invites', { method: 'POST', body: JSON.stringify({ login: invitee }) })).status).toBe(400);

		// Invited: joins the team as member, no workspace of their own, lands in it; the invite is consumed.
		const { token } = await signIn(invitee, inviteeGithubId);
		expect(token).toBeTruthy();
		inviteeUserId = (await db.identity.findFirstOrThrow({ where: { login: invitee } })).userId;
		expect(await me(token!)).toMatchObject({ workspaceId: team, role: 'member', workspaces: [{ id: team }] });
		expect(await db.invite.count({ where: { login: invitee } })).toBe(0);

		// Members can't manage; owner sees them and can't remove themselves.
		expect((await call(token!, '/invites', { method: 'POST', body: JSON.stringify({ login: 'someone' }) })).status).toBe(403);
		const list = (await (await call(ownerToken, '/members')).json()) as { members: { login: string | null; role: string }[] };
		expect(list.members).toContainEqual(expect.objectContaining({ login: invitee, role: 'member' }));
		expect((await call(ownerToken, `/members/${owner.id}`, { method: 'DELETE' })).status).toBe(404);

		// Can't switch into a workspace they aren't in.
		const other = await db.workspace.create({ data: { name: 'other' } });
		expect((await call(token!, `/workspaces/${other.id}/switch`, { method: 'POST' })).status).toBe(404);
		await db.workspace.delete({ where: { id: other.id } });

		// Removed → no workspace left → the session stops working; and they can't sign in again.
		expect((await call(ownerToken, `/members/${inviteeUserId}`, { method: 'DELETE' })).status).toBe(204);
		expect((await auth.request('/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
		expect(await signIn(invitee, inviteeGithubId)).toMatchObject({ error: 'forbidden' });
	} finally {
		await db.workspace.delete({ where: { id: team } });
		await db.user.deleteMany({ where: { id: { in: [owner.id, inviteeUserId].filter(Boolean) } } });
	}
});

test('workspaces: allowlisted user creates and renames workspaces; one installation links to N of them, owner only', async () => {
	const login = `founder-${suffix}`;
	const githubId = Number(Date.now() % 1e9) + 7;
	const installationId = Date.now();
	env.ALLOWED_GITHUB_LOGINS.push(login);
	let userId = '';

	try {
		// Signup: own workspace, gets the installations the user can see.
		const { token } = await signIn(login, githubId, { installations: [installationId] });
		userId = (await db.identity.findFirstOrThrow({ where: { login } })).userId;
		const first = (await (await auth.request('/me', { headers: { Authorization: `Bearer ${token}` } })).json()) as { workspaceId: string; canCreateWorkspace: boolean };
		expect(first.canCreateWorkspace).toBe(true);
		expect(await db.installation.count({ where: { workspaceId: first.workspaceId, githubInstallationId: BigInt(installationId) } })).toBe(1);

		const call = (path: string, init: RequestInit = {}) =>
			workspaces.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
		expect((await call('/workspaces', { method: 'POST', body: JSON.stringify({ name: ' ' }) })).status).toBe(400);
		const res = await call('/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Time B' }) });
		expect(res.status).toBe(201);
		const { id: second } = (await res.json()) as { id: string };
		expect((await call('/workspace', { method: 'PATCH', body: JSON.stringify({ name: 'Time B2' }) })).status).toBe(204);
		expect((await db.workspace.findUniqueOrThrow({ where: { id: second } })).name).toBe('Time B2');

		// Plain login links nothing; connect for the second workspace links the same installation there and goes to GitHub's install page.
		await signIn(login, githubId, { installations: [installationId] });
		expect(await db.installation.count({ where: { workspaceId: second } })).toBe(0);
		const connect = await signIn(login, githubId, { kind: 'connect', workspaceId: second, installations: [installationId] });
		expect(connect.location.hostname).toBe('github.com');
		expect(await db.installation.count({ where: { githubInstallationId: BigInt(installationId) } })).toBe(2);

		// A workspace they don't own gets nothing.
		const foreign = await db.workspace.create({ data: { name: 'foreign' } });
		await signIn(login, githubId, { kind: 'connect', workspaceId: foreign.id, installations: [installationId] });
		expect(await db.installation.count({ where: { workspaceId: foreign.id } })).toBe(0);
		await db.workspace.delete({ where: { id: foreign.id } });

		// Not allowlisted anymore: can't create.
		env.ALLOWED_GITHUB_LOGINS.pop();
		expect((await call('/workspaces', { method: 'POST', body: JSON.stringify({ name: 'C' }) })).status).toBe(403);
	} finally {
		await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
		if (userId) await db.user.delete({ where: { id: userId } });
	}
});
