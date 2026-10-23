import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';
// env may already be parsed by another test file in this process.
const { env } = await import('./env');
env.SECRETS_KEY ??= Buffer.alloc(32, 3).toString('base64');

const { sha256 } = await import('./auth');
const { db } = await import('./db');
const { adfToText, chunkDoc, knowledge, searchChunks, syncSource } = await import('./knowledge');

test('chunkDoc: one chunk per section, headings inside code fences ignored, long text cut', () => {
	const chunks = chunkDoc('Spec', 'intro\n\n# Pagamentos\nregra A\n```sh\n# não é título\n```\n## Estorno\nregra B\n\n' + 'x'.repeat(7000));
	// Estorno: its short paragraph, then the 7000 chars in 3 pieces.
	expect(chunks.map((c) => c.ref)).toEqual(['Spec', 'Spec § Pagamentos', ...Array(4).fill('Spec § Estorno')]);
	expect(chunks[1]!.content).toContain('# não é título');
	expect(Math.max(...chunks.map((c) => c.content.length))).toBeLessThanOrEqual(3000);
});

test('adfToText: paragraphs, lists, mentions', () => {
	const doc = {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Olá ' }, { type: 'mention', attrs: { text: '@Ana' } }] },
			{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
		],
	};
	expect(adfToText(doc)).toBe('Olá @Ana\n- item\n');
});

test('docs + Jira: upload, sync with pagination, search scoped to the given sources', async () => {
	const user = await db.user.create({
		data: { name: 'test', memberships: { create: { workspace: { create: { name: 'test' } } } } },
		include: { memberships: true },
	});
	const workspaceId = user.memberships[0]!.workspaceId;
	const token = crypto.randomUUID();
	await db.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
	const post = (path: string, body: object) =>
		knowledge.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const project = await db.project.create({ data: { workspaceId, name: 'p' } });
	const other = await db.project.create({ data: { workspaceId, name: 'other' } });

	const issue = (key: string, summary: string) => ({
		key,
		fields: { summary, status: { name: 'Em andamento' }, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Critério: estorno em até 7 dias.' }] }] } },
	});
	const realFetch = globalThis.fetch;
	const urls: string[] = [];
	globalThis.fetch = (async (url: URL) => {
		urls.push(String(url));
		const page2 = url.searchParams.get('nextPageToken') === 'p2';
		return Response.json(page2 ? { issues: [issue('PAG-2', 'Estorno parcial')] } : { issues: [issue('PAG-1', 'Checkout com Pix')], nextPageToken: 'p2' });
	}) as typeof fetch;

	try {
		const doc = await post(`/projects/${project.id}/docs`, { title: 'Regras', content: '# Pagamentos\nO pagamento aprovado gera nota fiscal.' });
		expect(doc.status).toBe(201);
		const otherDoc = await post(`/projects/${other.id}/docs`, { title: 'Outro', content: 'pagamento de outro projeto' });
		const { id: otherId } = (await otherDoc.json()) as { id: string };

		expect((await post(`/projects/${project.id}/jira`, { baseUrl: 'http://127.0.0.1', email: 'a@b.co', token: 't', jql: 'project = PAG' })).status).toBe(400);
		const jira = await post(`/projects/${project.id}/jira`, { baseUrl: 'https://1.1.1.1/jira', email: 'a@b.co', token: 'secret-token', jql: 'project = PAG' });
		const { id: jiraId } = (await jira.json()) as { id: string };
		await syncSource(jiraId);

		const source = await db.projectSource.findUniqueOrThrow({ where: { id: jiraId }, include: { chunks: true } });
		expect(source.status).toBe('ready');
		expect(JSON.stringify(source.config)).not.toContain('secret-token');
		expect(source.chunks.map((c) => c.ref).sort()).toEqual(['PAG-1', 'PAG-2']);
		expect(source.chunks.find((c) => c.ref === 'PAG-1')).toMatchObject({ url: 'https://1.1.1.1/browse/PAG-1', content: expect.stringContaining('Status: Em andamento') });
		expect(urls[0]).toContain('/rest/api/3/search/jql?jql=project+%3D+PAG');

		const ids = (await db.projectSource.findMany({ where: { projectId: project.id } })).map((s) => s.id);
		// Stemming: "pagamentos" finds "pagamento"; other project's doc stays out.
		const hits = await searchChunks(ids, 'pagamentos');
		expect(hits.map((h) => h.ref)).toEqual(['Regras § Pagamentos']);
		expect(hits[0]!.snippet).toContain('«pagamento»');
		expect(hits.some((h) => h.ref === 'Outro')).toBe(false);
		expect((await searchChunks([otherId], 'pagamento')).map((h) => h.ref)).toEqual(['Outro']);
		// AND finds nothing → falls back to any of the words.
		expect((await searchChunks(ids, 'estorno inexistentezzz')).map((h) => h.ref).sort()).toEqual(['PAG-1', 'PAG-2']);
	} finally {
		globalThis.fetch = realFetch;
		await db.workspace.delete({ where: { id: workspaceId } });
		await db.user.delete({ where: { id: user.id } });
	}
});
