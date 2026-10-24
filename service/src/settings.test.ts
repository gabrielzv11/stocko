import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';
process.env.SECRETS_KEY ||= Buffer.alloc(32, 1).toString('base64');

const { sha256 } = await import('./auth');
const { db } = await import('./db');
const { env } = await import('./env');
const { settings, workspaceLlm } = await import('./settings');

test('settings: Mangaba needs a key the router accepts; the key is never returned', async () => {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const workspaceId = user.memberships[0]!.workspaceId;
	const token = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const put = (body: object) => settings.request('/settings', { method: 'PUT', headers, body: JSON.stringify(body) });

	// GET /models do Mangaba: só mr-good é aceita.
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init?: RequestInit) =>
		new Response(null, { status: (init?.headers as Record<string, string>).authorization === 'Bearer mr-good' ? 200 : 401 })) as typeof fetch;

	try {
		expect((await put({ provider: 'mangaba', model: '' })).status).toBe(400);
		expect((await put({ provider: 'mangaba', model: '', mangabaApiKey: 'mr-bad' })).status).toBe(400);
		expect((await put({ provider: 'mangaba', model: '', mangabaApiKey: 'mr-good' })).status).toBe(204);
		// Chave salva: trocar só o modelo não pede de novo.
		expect((await put({ provider: 'mangaba', model: 'mangaba-coder' })).status).toBe(204);

		const res = await settings.request('/settings', { headers });
		const body = await res.text();
		expect(body).not.toContain('mr-good');
		expect(JSON.parse(body)).toMatchObject({ provider: 'mangaba', model: 'mangaba-coder', hasMangabaKey: true });
		expect(await workspaceLlm(workspaceId)).toMatchObject({ provider: 'mangaba', model: 'mangaba-coder' });

		expect((await put({ provider: 'openrouter', model: '' })).status).toBe(204);
		expect(await workspaceLlm(workspaceId)).toMatchObject({ provider: 'openrouter', model: env.LLM_MODEL });
	} finally {
		globalThis.fetch = realFetch;
		await db.workspace.delete({ where: { id: workspaceId } });
		await db.user.delete({ where: { id: user.id } });
	}
});
