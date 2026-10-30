import { Hono } from 'hono';
import { z } from 'zod';
import { randomToken, requireAuth, sha256, type AuthVars } from './auth';
import { spendCapError, type turnUsage } from './chat';
import { db } from './db';
import { QueryError } from './query';

export const MAX_CALLS_PER_MINUTE = 60;
/** Each ask is an agent run on the workspace's LLM. */
export const MAX_ASKS_PER_MINUTE = 5;

/** API key in `Authorization: Bearer stk_...`: acts as its user, in the workspace it was created in. */
export type Key = { id: string; workspaceId: string };

/** Valid, unrevoked key whose user is still a member of its workspace, or null. */
export async function authenticate(authorization: string | undefined): Promise<Key | null> {
	const token = authorization?.match(/^Bearer (.+)$/)?.[1];
	if (!token) return null;
	const key = await db.apiKey.findUnique({ where: { keyHash: sha256(token) } });
	if (!key || key.revokedAt) return null;
	// Removed from the workspace → the key stops working at once.
	const member = await db.member.findUnique({ where: { workspaceId_userId: { workspaceId: key.workspaceId, userId: key.userId } } });
	return member ? { id: key.id, workspaceId: key.workspaceId } : null;
}

/** Why `key` can't call `tool` now, or null. Counts McpCall rows, in-flight ones included: no in-memory state. */
// ponytail: check-then-insert isn't atomic; a parallel burst can pass the limit by its own size.
export async function rateLimitError(key: Key, tool: string) {
	const recent = { keyId: key.id, createdAt: { gte: new Date(Date.now() - 60_000) }, OR: [{ errorCode: null }, { errorCode: { not: 'RATE_LIMITED' } }] };
	const [calls, asks] = await Promise.all([db.mcpCall.count({ where: recent }), tool === 'ask' ? db.mcpCall.count({ where: { ...recent, tool } }) : 0]);
	if (calls >= MAX_CALLS_PER_MINUTE) return `Limite de ${MAX_CALLS_PER_MINUTE} chamadas por minuto por chave; aguarde.`;
	if (tool !== 'ask') return null;
	if (asks >= MAX_ASKS_PER_MINUTE) return `Limite de ${MAX_ASKS_PER_MINUTE} chamadas de ask por minuto por chave; aguarde.`;
	return spendCapError(key.workspaceId);
}

export type Usage = Awaited<ReturnType<typeof turnUsage>>;

/** Runs one call of `key`: rate limit, then a McpCall row with tool, project, outcome, duration and LLM usage. Never content. */
export async function logged<T>(key: Key, tool: string, projectId: string | undefined, fn: () => Promise<{ output: T; usage?: Usage }>) {
	const base = { keyId: key.id, workspaceId: key.workspaceId, tool, projectId };
	const limited = await rateLimitError(key, tool);
	if (limited) {
		await db.mcpCall.create({ data: { ...base, ok: false, errorCode: 'RATE_LIMITED', durationMs: 0 } });
		throw new QueryError('RATE_LIMITED', limited);
	}
	const call = await db.mcpCall.create({ data: base });
	const started = performance.now();
	const durationMs = () => Math.round(performance.now() - started);
	try {
		const { output, usage } = await fn();
		await db.mcpCall.update({ where: { id: call.id }, data: { ok: true, durationMs: durationMs(), ...usage } });
		return output;
	} catch (e) {
		await db.mcpCall.update({ where: { id: call.id }, data: { ok: false, durationMs: durationMs(), errorCode: e instanceof QueryError ? e.code : 'INTERNAL' } });
		throw e;
	}
}

export const keys = new Hono<{ Variables: AuthVars }>();

// Own keys in the active workspace.
keys.get('/api-keys', requireAuth, async (c) => {
	const list = await db.apiKey.findMany({
		where: { userId: c.var.userId, workspaceId: c.var.workspaceId, revokedAt: null },
		orderBy: { createdAt: 'desc' },
		select: { id: true, name: true, prefix: true, createdAt: true, calls: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
	});
	return c.json(list.map(({ calls, ...k }) => ({ ...k, lastUsedAt: calls[0]?.createdAt ?? null })));
});

// The key is shown once; only its sha256 is stored.
keys.post('/api-keys', requireAuth, async (c) => {
	const body = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Dê um nome à chave (até 60 caracteres).' }, 400);
	const key = `stk_${randomToken()}`;
	const created = await db.apiKey.create({
		data: { userId: c.var.userId, workspaceId: c.var.workspaceId, name: body.data.name, keyHash: sha256(key), prefix: key.slice(0, 10) },
		select: { id: true, name: true, prefix: true, createdAt: true },
	});
	return c.json({ ...created, key }, 201);
});

// Revoked, not deleted: its calls keep counting in the spend cap and /usage.
keys.delete('/api-keys/:id', requireAuth, async (c) => {
	const { count } = await db.apiKey.updateMany({
		where: { id: c.req.param('id'), userId: c.var.userId, workspaceId: c.var.workspaceId, revokedAt: null },
		data: { revokedAt: new Date() },
	});
	return count ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});
