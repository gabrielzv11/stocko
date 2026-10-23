import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { sha256 } = await import('./auth');
const { chat } = await import('./chat');
const { db } = await import('./db');
const { env } = await import('./env');

test('chat: 400 on an oversized question, 429 over the 24h spend cap and the per-minute rate, before touching the LLM', async () => {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const workspaceId = user.memberships[0]!.workspaceId;
	const token = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
	const conversation = await db.conversation.create({ data: { workspaceId } });
	const ask = async (text = 'oi') => {
		const res = await chat.request(`/conversations/${conversation.id}/messages`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: { role: 'user', parts: [{ type: 'text', text }] } }),
		});
		return { status: res.status, body: (await res.json()) as { message: string } };
	};

	try {
		expect(await ask('x'.repeat(20_001))).toMatchObject({ status: 400, body: { message: expect.stringContaining('longa demais') } });

		const spent = await db.message.create({
			data: { conversationId: conversation.id, role: 'assistant', parts: [], cost: env.MAX_DAILY_COST_USD },
		});
		expect(await ask()).toMatchObject({ status: 429, body: { message: expect.stringContaining('gasto') } });

		await db.message.delete({ where: { id: spent.id } });
		await db.message.createMany({ data: Array.from({ length: 10 }, () => ({ conversationId: conversation.id, role: 'user', parts: [] })) });
		expect(await ask()).toMatchObject({ status: 429, body: { message: expect.stringContaining('aguarde') } });
	} finally {
		await db.workspace.delete({ where: { id: workspaceId } });
		await db.user.delete({ where: { id: user.id } });
	}
});

test('feedback: only on assistant messages of the own workspace; comes back as metadata', async () => {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const workspaceId = user.memberships[0]!.workspaceId;
	const other = await db.workspace.create({ data: { name: 'other' } });
	const token = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const rate = (id: string, value: 1 | -1 | null) => chat.request(`/messages/${id}/feedback`, { method: 'PUT', headers, body: JSON.stringify({ value }) }).then((r) => r.status);

	try {
		const conversation = await db.conversation.create({ data: { workspaceId } });
		const question = await db.message.create({ data: { conversationId: conversation.id, role: 'user', parts: [] } });
		const answer = await db.message.create({ data: { conversationId: conversation.id, role: 'assistant', parts: [] } });
		const foreign = await db.conversation.create({ data: { workspaceId: other.id, messages: { create: { role: 'assistant', parts: [] } } }, include: { messages: true } });

		expect(await rate(answer.id, 1)).toBe(204);
		expect(await rate(question.id, 1)).toBe(404);
		expect(await rate(foreign.messages[0]!.id, -1)).toBe(404);
		expect((await db.message.findUniqueOrThrow({ where: { id: foreign.messages[0]!.id } })).feedback).toBeNull();

		const res = await chat.request(`/conversations/${conversation.id}`, { headers });
		const { messages } = (await res.json()) as { messages: { id: string; metadata: { feedback: number | null } }[] };
		expect(messages.find((m) => m.id === answer.id)?.metadata.feedback).toBe(1);
	} finally {
		await db.workspace.deleteMany({ where: { id: { in: [workspaceId, other.id] } } });
		await db.user.delete({ where: { id: user.id } });
	}
});
