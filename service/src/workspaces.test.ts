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

const suffix = Date.now().toString(36);

/** Runs the OAuth callback with GitHub mocked as `login`; returns the session token, or the error in the redirect. */
async function signIn(login: string, githubId: number) {
	const state = crypto.randomUUID();
	await db.oAuthState.create({ data: { state, kind: 'login', expiresAt: new Date(Date.now() + 60_000) } });
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string) => {
		if (url.includes('/login/oauth/access_token')) return Response.json({ access_token: 'gho_test' });
		if (url.endsWith('/user')) return Response.json({ id: githubId, login, name: null, avatar_url: '' });
		return Response.json({ installations: [] });
	}) as typeof fetch;
	try {
		const res = await auth.request(`/auth/github/callback?code=c&state=${state}`);
		const hash = new URL(res.headers.get('Location')!).hash;
		return { token: hash.match(/token=(.+)/)?.[1], error: hash.match(/error=(.+)/)?.[1] };
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
