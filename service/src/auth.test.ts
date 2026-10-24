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

const me = (token?: string) => auth.request('/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('requireAuth: rejects missing, unknown and expired tokens; accepts valid scoped to workspace', async () => {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const workspaceId = user.memberships[0]!.workspaceId;
	const session = async (expiresAt: Date) => {
		const token = crypto.randomUUID();
		await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt } });
		return token;
	};

	try {
		expect((await me()).status).toBe(401);
		expect((await me('nope')).status).toBe(401);
		expect((await me(await session(new Date(Date.now() - 1000)))).status).toBe(401);

		const res = await me(await session(new Date(Date.now() + 60_000)));
		expect(res.status).toBe(200);
		expect(((await res.json()) as { workspaceId: string }).workspaceId).toBe(workspaceId);
	} finally {
		await db.workspace.delete({ where: { id: workspaceId } });
		await db.user.delete({ where: { id: user.id } });
	}
});
