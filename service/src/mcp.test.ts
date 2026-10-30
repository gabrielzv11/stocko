import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { sha256 } = await import('./auth');
const { db } = await import('./db');
const { env } = await import('./env');
const { MAX_ASKS_PER_MINUTE, MAX_CALLS_PER_MINUTE, authenticate, keys, logged, rateLimitError } = await import('./keys');
const { mcp } = await import('./mcp');

/** User with a session in a fresh workspace. */
async function member() {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const token = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
	return { user, workspaceId: user.memberships[0]!.workspaceId, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

const cleanup = async (...ms: { user: { id: string }; workspaceId: string }[]) => {
	await db.workspace.deleteMany({ where: { id: { in: ms.map((m) => m.workspaceId) } } });
	await db.user.deleteMany({ where: { id: { in: ms.map((m) => m.user.id) } } });
};

test('keys: shown once, stored hashed, own only; revoking or leaving the workspace kills them', async () => {
	const a = await member();
	const b = await member();
	try {
		const res = await keys.request('/api-keys', { method: 'POST', headers: a.headers, body: JSON.stringify({ name: 'ci' }) });
		expect(res.status).toBe(201);
		const { id, key } = (await res.json()) as { id: string; key: string };
		expect(key).toStartWith('stk_');
		expect(await db.apiKey.count({ where: { keyHash: key } })).toBe(0);
		expect(await authenticate(`Bearer ${key}`)).toEqual({ id, workspaceId: a.workspaceId });
		expect(await authenticate(`Bearer ${key}x`)).toBeNull();
		expect(await authenticate(undefined)).toBeNull();

		const listed = async (m: typeof a) => ((await (await keys.request('/api-keys', { headers: m.headers })).json()) as { id: string }[]).map((k) => k.id);
		expect(await listed(a)).toEqual([id]);
		expect(await listed(b)).toEqual([]);
		expect((await keys.request(`/api-keys/${id}`, { method: 'DELETE', headers: b.headers })).status).toBe(404);

		await db.member.delete({ where: { workspaceId_userId: { workspaceId: a.workspaceId, userId: a.user.id } } });
		expect(await authenticate(`Bearer ${key}`)).toBeNull();
		await db.member.create({ data: { workspaceId: a.workspaceId, userId: a.user.id } });
		expect(await authenticate(`Bearer ${key}`)).not.toBeNull();

		expect((await keys.request(`/api-keys/${id}`, { method: 'DELETE', headers: a.headers })).status).toBe(204);
		expect(await authenticate(`Bearer ${key}`)).toBeNull();
	} finally {
		await cleanup(a, b);
	}
});

test('rate limit: per key, lower for ask, spend cap on ask; limited calls are logged but do not extend the limit', async () => {
	const a = await member();
	try {
		const key = await db.apiKey.create({ data: { userId: a.user.id, workspaceId: a.workspaceId, name: 'k', keyHash: sha256(crypto.randomUUID()), prefix: 'stk_' } });
		const k = { id: key.id, workspaceId: a.workspaceId };
		const other = await db.apiKey.create({ data: { userId: a.user.id, workspaceId: a.workspaceId, name: 'k2', keyHash: sha256(crypto.randomUUID()), prefix: 'stk_' } });
		const calls = (n: number, tool: string, extra = {}) =>
			db.mcpCall.createMany({ data: Array.from({ length: n }, () => ({ keyId: key.id, workspaceId: a.workspaceId, tool, ok: true, ...extra })) });

		await calls(MAX_ASKS_PER_MINUTE, 'ask');
		expect(await rateLimitError(k, 'ask')).toContain('ask');
		expect(await rateLimitError(k, 'search_code')).toBeNull();
		// Rejected calls don't count, or a client retrying would never get out.
		await calls(MAX_CALLS_PER_MINUTE, 'search_code', { ok: false, errorCode: 'RATE_LIMITED' });
		expect(await rateLimitError(k, 'search_code')).toBeNull();
		await calls(MAX_CALLS_PER_MINUTE - MAX_ASKS_PER_MINUTE, 'read_file');
		expect(await rateLimitError(k, 'read_file')).toContain('por minuto');
		expect(await rateLimitError({ id: other.id, workspaceId: a.workspaceId }, 'read_file')).toBeNull();

		expect(await logged(k, 'read_file', 'p1', async () => ({ output: 'never' })).catch((e: { code?: string }) => e.code)).toBe('RATE_LIMITED');
		expect(await db.mcpCall.count({ where: { keyId: key.id, tool: 'read_file', errorCode: 'RATE_LIMITED' } })).toBe(1);

		// Spend cap is the workspace's: another key of it is blocked too, and so is the chat.
		await db.mcpCall.createMany({ data: { keyId: other.id, workspaceId: a.workspaceId, tool: 'ask', ok: true, cost: env.MAX_DAILY_COST_USD, createdAt: new Date(Date.now() - 3_600_000) } });
		expect(await rateLimitError({ id: other.id, workspaceId: a.workspaceId }, 'ask')).toContain('gasto');
	} finally {
		await cleanup(a);
	}
});

test('logged: one row per call with outcome and duration, no content', async () => {
	const a = await member();
	try {
		const key = await db.apiKey.create({ data: { userId: a.user.id, workspaceId: a.workspaceId, name: 'k', keyHash: sha256(crypto.randomUUID()), prefix: 'stk_' } });
		const k = { id: key.id, workspaceId: a.workspaceId };
		expect(await logged(k, 'read_file', 'p1', async () => ({ output: { content: 'secret code' } }))).toEqual({ content: 'secret code' });
		await logged(k, 'ask', 'p1', async () => {
			throw new Error('boom');
		}).catch(() => {});
		const rows = await db.mcpCall.findMany({ where: { keyId: key.id }, orderBy: { createdAt: 'asc' } });
		expect(rows.map((r) => [r.tool, r.projectId, r.ok, r.errorCode, typeof r.durationMs])).toEqual([
			['read_file', 'p1', true, null, 'number'],
			['ask', 'p1', false, 'INTERNAL', 'number'],
		]);
	} finally {
		await cleanup(a);
	}
});

test('/mcp: 401 without a valid key; with one, lists the tools and errors carry a stable code', async () => {
	const a = await member();
	const b = await member();
	try {
		const key = `stk_${crypto.randomUUID()}`;
		await db.apiKey.create({ data: { userId: a.user.id, workspaceId: a.workspaceId, name: 'k', keyHash: sha256(key), prefix: key.slice(0, 10) } });
		const project = await db.project.create({ data: { workspaceId: b.workspaceId, name: 'theirs' } });
		const rpc = (method: string, params: object, auth = key) =>
			mcp.request('/mcp', {
				method: 'POST',
				headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			});

		const denied = await rpc('tools/list', {}, 'stk_nope');
		expect(denied.status).toBe(401);
		expect(await denied.json()).toMatchObject({ error: 'UNAUTHORIZED' });

		const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
		expect(init.status).toBe(200);
		expect(await init.json()).toMatchObject({ result: { serverInfo: { name: 'stocko' } } });

		const list = (await (await rpc('tools/list', {})).json()) as { result: { tools: { name: string }[] } };
		expect(list.result.tools.map((t) => t.name).sort()).toEqual(['ask', 'list_projects', 'read_file', 'search_code']);

		const call = (await (await rpc('tools/call', { name: 'read_file', arguments: { project: project.id, path: 'a.ts' } })).json()) as {
			result: { isError: boolean; content: { text: string }[] };
		};
		expect(call.result.isError).toBe(true);
		expect(JSON.parse(call.result.content[0]!.text)).toMatchObject({ error: 'PROJECT_NOT_FOUND' });
	} finally {
		await cleanup(a, b);
	}
});
