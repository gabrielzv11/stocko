import { expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { db } = await import('./db');
const { keptFrom, summarize, titleConversation, unsummarized } = await import('./summary');

const msg = (id: string, role: string, text = id) => ({ id, role, parts: [{ type: 'text', text }] });

test('keptFrom / unsummarized: last 2 turns stay, prefix up to summarizedUntil is dropped', () => {
	const m = [msg('u1', 'user'), msg('a1', 'assistant'), msg('u2', 'user'), msg('a2', 'assistant'), msg('u3', 'user'), msg('a3', 'assistant')];
	expect(keptFrom(m)).toBe(2);
	expect(keptFrom(m.slice(2))).toBe(0);
	expect(unsummarized(m, null)).toHaveLength(6);
	expect(unsummarized(m, 'a1').map((x) => x.id)).toEqual(['u2', 'a2', 'u3', 'a3']);
});

test('summarize: folds older turns on top of the previous summary', async () => {
	const model = new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: 'text', text: 'resumo novo' }],
			finishReason: { unified: 'stop', raw: 'stop' },
			usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
			warnings: [],
		},
	});
	const workspace = await db.workspace.create({ data: { name: 'test' } });
	try {
		const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, summary: 'resumo antigo' } });
		const ids: string[] = [];
		for (const [role, text] of [
			['user', 'onde fica o login?'],
			['assistant', 'em `acme/app/src/auth.ts#L1-L9@abc1234`'],
			['user', 'e o logout?'],
			['assistant', 'logo abaixo'],
			['user', 'e o refresh?'],
			['assistant', 'não existe'],
		])
			ids.push((await db.message.create({ data: { conversationId: conversation.id, role: role!, parts: [{ type: 'text', text }] } })).id);

		await summarize(conversation.id, model);

		expect(await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).toMatchObject({ summary: 'resumo novo', summarizedUntilMessageId: ids[1] });
		const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
		expect(prompt).toContain('resumo antigo');
		expect(prompt).toContain('acme/app/src/auth.ts#L1-L9@abc1234');
		expect(prompt).not.toContain('e o logout?');
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});

test('titleConversation: model title replaces the provisional one, cleaned and capped; empty output keeps it', async () => {
	const reply = (text: string) =>
		new MockLanguageModelV4({
			doGenerate: {
				content: [{ type: 'text', text }],
				finishReason: { unified: 'stop', raw: 'stop' },
				usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
				warnings: [],
			},
		});
	const workspace = await db.workspace.create({ data: { name: 'test' } });
	try {
		const { id } = await db.conversation.create({ data: { workspaceId: workspace.id, title: 'onde fica o login do app...' } });
		const title = async () => (await db.conversation.findUniqueOrThrow({ where: { id } })).title;

		await titleConversation(id, 'onde fica o login do app?', reply('  "   '), 80);
		expect(await title()).toBe('onde fica o login do app...');

		await titleConversation(id, 'onde fica o login do app?', reply('"Localização do login."\n'), 80);
		expect(await title()).toBe('Localização do login');

		await titleConversation(id, 'x', reply('a'.repeat(200)), 80);
		expect(await title()).toHaveLength(80);
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});
