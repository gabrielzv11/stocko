import { tool } from 'ai';
import { Hono } from 'hono';
import { z } from 'zod';
import { assertPublicUrl, readCapped, seal, unseal } from './apis';
import { forbidden, requireAuth, requireOwner, type AuthVars } from './auth';
import { db } from './db';

// Docs and Jira: "what it should be" next to the code ("what it is"). Retrieval is Postgres full-text ('portuguese'):
// no embedding provider, no cost, and the agent already rephrases its own queries.
// ponytail: to_tsvector on the fly, no index — fine up to some tens of thousands of chunks; then a stored tsvector + GIN,
// or pgvector embeddings if keyword search starts missing paraphrases.

const MAX_CHUNK = 3000;
const MAX_ISSUE_CHARS = 8000;
const MAX_ISSUES = 2000;
const MAX_RESULTS = 10;
const MAX_BYTES = 16 * 1024;
const TRUNCATED = '\n[truncado — refine a busca]';
const JIRA_TIMEOUT_MS = 30_000;
const STALE_MS = 30 * 60_000;

type JiraConfig = { baseUrl: string; email: string; jql: string; token: string };
type DocConfig = { title: string };

// ---------- chunking ----------

/** Markdown/text → one chunk per section (headings # to ###, outside code fences), long sections cut at paragraphs. */
export function chunkDoc(title: string, text: string) {
	const out: { ref: string; title: string; content: string }[] = [];
	let heading = '';
	let lines: string[] = [];
	let fence = false;

	const flush = () => {
		const body = lines.join('\n').trim();
		lines = [];
		if (!body) return;
		const ref = heading ? `${title} § ${heading}` : title;
		let piece = '';
		const push = () => {
			if (piece.trim()) out.push({ ref, title: ref, content: piece.trim() });
			piece = '';
		};
		for (const para of body.split(/\n{2,}/)) {
			if (piece && piece.length + para.length + 2 > MAX_CHUNK) push();
			// A single paragraph over the limit is cut hard.
			for (let i = 0; i < para.length; i += MAX_CHUNK) {
				if (i) push();
				piece = piece ? `${piece}\n\n${para.slice(i, i + MAX_CHUNK)}` : para.slice(i, i + MAX_CHUNK);
			}
		}
		push();
	};

	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence;
		const h = !fence && line.match(/^#{1,3}\s+(.+?)\s*#*$/);
		if (h) {
			flush();
			heading = h[1]!;
		}
		lines.push(line);
	}
	flush();
	return out;
}

/** Atlassian Document Format (descriptions in Jira API v3) → plain text. */
export function adfToText(node: unknown): string {
	if (!node || typeof node !== 'object') return '';
	const n = node as { type?: string; text?: string; attrs?: { text?: string }; content?: unknown[] };
	if (n.type === 'text') return n.text ?? '';
	if (n.type === 'hardBreak') return '\n';
	if (n.type === 'mention' || n.type === 'emoji') return n.attrs?.text ?? '';
	const inner = (n.content ?? []).map(adfToText).join('');
	if (n.type === 'listItem') return `- ${inner}`;
	if (n.type === 'tableCell' || n.type === 'tableHeader') return `${inner.trim()} | `;
	return ['paragraph', 'heading', 'codeBlock', 'blockquote', 'tableRow', 'rule'].includes(n.type ?? '') ? `${inner}\n` : inner;
}

// ---------- jira ----------

type Issue = {
	key: string;
	fields: {
		summary?: string;
		description?: unknown;
		status?: { name?: string };
		issuetype?: { name?: string };
		assignee?: { displayName?: string } | null;
		labels?: string[];
		updated?: string;
		parent?: { key?: string };
	};
};

/** Every issue matching the JQL (up to MAX_ISSUES), Jira Cloud search with email + API token. */
async function fetchIssues(cfg: JiraConfig) {
	// ponytail: checks DNS before the fetches (rebinding window), same as call_api.
	const base = (await assertPublicUrl(cfg.baseUrl)).origin;
	const headers = { Authorization: `Basic ${Buffer.from(`${cfg.email}:${unseal(cfg.token)}`).toString('base64')}`, Accept: 'application/json' };
	const issues: Issue[] = [];
	let nextPageToken: string | undefined;
	do {
		const url = new URL('/rest/api/3/search/jql', base);
		url.searchParams.set('jql', cfg.jql);
		url.searchParams.set('fields', 'summary,description,status,issuetype,assignee,labels,updated,parent');
		url.searchParams.set('maxResults', '100');
		if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
		// redirect: 'manual' — a 3xx to an internal host would bypass the SSRF check.
		const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(JIRA_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`Jira respondeu ${res.status}: ${(await readCapped(res, 300)).slice(0, 300)}`);
		const data = (await res.json()) as { issues?: Issue[]; nextPageToken?: string };
		issues.push(...(data.issues ?? []));
		nextPageToken = data.nextPageToken;
	} while (nextPageToken && issues.length < MAX_ISSUES);
	return { base, issues };
}

export function issueChunk(base: string, i: Issue) {
	const f = i.fields;
	const meta = [
		f.issuetype?.name && `Tipo: ${f.issuetype.name}`,
		f.status?.name && `Status: ${f.status.name}`,
		f.assignee?.displayName && `Responsável: ${f.assignee.displayName}`,
		f.parent?.key && `Pai: ${f.parent.key}`,
		f.labels?.length && `Labels: ${f.labels.join(', ')}`,
		f.updated && `Atualizado: ${f.updated.slice(0, 10)}`,
	].filter(Boolean);
	const content = [`${i.key}: ${f.summary ?? ''}`, ...meta, '', adfToText(f.description).trim()].join('\n');
	return { ref: i.key, title: `${i.key} ${f.summary ?? ''}`, url: `${base}/browse/${i.key}`, content: content.slice(0, MAX_ISSUE_CHARS) };
}

const inflight = new Map<string, Promise<void>>();

/** Re-reads a Jira source into its chunks. Concurrent calls share one run; never rejects. */
export function syncSource(sourceId: string) {
	let pending = inflight.get(sourceId);
	if (!pending) {
		pending = doSync(sourceId)
			.catch((e) => console.error(`[knowledge] ${sourceId}:`, e))
			.finally(() => inflight.delete(sourceId));
		inflight.set(sourceId, pending);
	}
	return pending;
}

async function doSync(sourceId: string) {
	const source = await db.projectSource.findUnique({ where: { id: sourceId } });
	if (source?.type !== 'jira') return;
	// updateMany: a source deleted mid-sync just matches nothing.
	const mark = (data: { status: string; error?: string | null; syncedAt?: Date }) => db.projectSource.updateMany({ where: { id: sourceId }, data });
	await mark({ status: 'syncing', error: null });
	try {
		const { base, issues } = await fetchIssues(source.config as JiraConfig);
		const chunks = issues.map((i) => ({ ...issueChunk(base, i), sourceId }));
		await db.$transaction([db.chunk.deleteMany({ where: { sourceId } }), db.chunk.createMany({ data: chunks })]);
		await mark({ status: 'ready', syncedAt: new Date() });
	} catch (e) {
		await mark({ status: 'error', error: (e as Error).message.slice(0, 500) });
	}
}

/** Kick a background re-sync of Jira sources never synced or older than STALE_MS. Doesn't wait. */
export async function refreshStaleSources(sourceIds: string[]) {
	const stale = await db.projectSource.findMany({
		where: {
			id: { in: sourceIds },
			type: 'jira',
			status: { not: 'syncing' },
			OR: [{ syncedAt: null }, { syncedAt: { lt: new Date(Date.now() - STALE_MS) } }],
		},
		select: { id: true },
	});
	for (const s of stale) void syncSource(s.id);
}

// ---------- search + tools ----------

type Hit = { id: string; ref: string; url: string | null; type: string; snippet: string };

/** Best chunks for `query` among `sourceIds`. websearch syntax: words are ANDed; nothing found → any of the words. */
export async function searchChunks(sourceIds: string[], query: string) {
	const run = (q: string) => db.$queryRaw<Hit[]>`
		SELECT c.id, c.ref, c.url, s.type::text AS type,
			ts_headline('portuguese', c.content, q, 'StartSel=«, StopSel=», MaxFragments=3, MaxWords=35, MinWords=12, FragmentDelimiter=" … "') AS snippet
		FROM "Chunk" c JOIN "ProjectSource" s ON s.id = c."sourceId", websearch_to_tsquery('portuguese', ${q}) q
		WHERE c."sourceId" = ANY(${sourceIds}) AND to_tsvector('portuguese', c.title || ' ' || c.content) @@ q
		ORDER BY ts_rank(to_tsvector('portuguese', c.title || ' ' || c.content), q) DESC
		LIMIT ${MAX_RESULTS}`;
	const hits = await run(query);
	const words = query.trim().split(/\s+/);
	if (hits.length || words.length < 2 || /["-]|\bor\b/i.test(query)) return hits;
	return run(words.join(' or '));
}

const cut = (text: string) => (text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) + TRUNCATED : text);

/** Tools over the doc/Jira sources of the turn's projects (already filtered by workspace). */
export function knowledgeTools(sourceIds: string[]) {
	const safe =
		<I>(fn: (input: I) => Promise<string>) =>
		(input: I) =>
			fn(input).catch((e: Error) => `erro: ${e.message}`);

	return {
		search_docs: tool({
			description: `Busca nos docs e tickets do Jira dos projetos (o que deveria ser: requisitos, regras, decisões, critérios de aceite). Palavras-chave curtas em português; "or" para alternativas, "-termo" exclui, aspas para frase exata. Até ${MAX_RESULTS} trechos com id, referência e URL; use read_doc para o texto completo.`,
			inputSchema: z.object({ query: z.string().trim().min(1).max(500) }),
			execute: safe(async ({ query }) => {
				const hits = await searchChunks(sourceIds, query);
				const text = hits.map((h) => `[id ${h.id}] ${h.type}: ${h.ref}${h.url ? ` <${h.url}>` : ''}\n${h.snippet}`).join('\n\n');
				return cut(text || 'nenhum resultado; tente sinônimos ou menos palavras');
			}),
		}),

		read_doc: tool({
			description: 'Lê o texto completo de um trecho de doc ou ticket do Jira pelo id vindo do search_docs.',
			inputSchema: z.object({ id: z.string() }),
			execute: safe(async ({ id }) => {
				const chunk = await db.chunk.findFirst({ where: { id, sourceId: { in: sourceIds } } });
				if (!chunk) throw new Error('trecho não encontrado; use um id do search_docs');
				return cut(`${chunk.ref}${chunk.url ? ` <${chunk.url}>` : ''}\n${chunk.content}`);
			}),
		}),
	};
}

// ---------- routes ----------

export const knowledge = new Hono<{ Variables: AuthVars }>();

const ownProject = (workspaceId: string, id: string) => db.project.findFirst({ where: { id, workspaceId } });

knowledge.get('/projects/:id/knowledge', requireAuth, async (c) => {
	const list = await db.projectSource.findMany({
		where: { projectId: c.req.param('id'), project: { workspaceId: c.var.workspaceId }, type: { in: ['doc', 'jira'] } },
		orderBy: { createdAt: 'asc' },
		include: { _count: { select: { chunks: true } } },
	});
	return c.json(
		list.map((s) => {
			// Never the token: only what identifies the source.
			const cfg = (s.config ?? {}) as Partial<JiraConfig & DocConfig>;
			return { id: s.id, type: s.type, title: cfg.title ?? cfg.jql ?? '', baseUrl: cfg.baseUrl ?? null, status: s.status, error: s.error, syncedAt: s.syncedAt, chunks: s._count.chunks };
		})
	);
});

const docBody = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(2 * 1024 * 1024) });

knowledge.post('/projects/:id/docs', requireAuth, async (c) => {
	const body = docBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Informe título e conteúdo (até 2 MB de texto).' }, 400);
	const project = await ownProject(c.var.workspaceId, c.req.param('id'));
	if (!project) return c.json({ error: 'not_found' }, 404);
	const { title, content } = body.data;
	const chunks = chunkDoc(title, content);
	if (!chunks.length) return c.json({ error: 'invalid_body', message: 'Documento sem texto.' }, 400);
	const source = await db.projectSource.create({
		data: { projectId: project.id, type: 'doc', config: { title } satisfies DocConfig, status: 'ready', syncedAt: new Date(), chunks: { create: chunks } },
	});
	return c.json({ id: source.id }, 201);
});

const jiraBody = z.object({
	baseUrl: z.url(),
	email: z.email(),
	token: z.string().trim().min(1).max(1000),
	jql: z.string().trim().min(1).max(2000),
});

// Owner only: the Jira token reads tickets on every member's questions.
knowledge.post('/projects/:id/jira', requireAuth, requireOwner, async (c) => {
	const body = jiraBody.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', message: 'Informe URL do Jira, e-mail, API token e JQL.' }, 400);
	const project = await ownProject(c.var.workspaceId, c.req.param('id'));
	if (!project) return c.json({ error: 'not_found' }, 404);
	const { baseUrl, email, token, jql } = body.data;
	try {
		const config: JiraConfig = { baseUrl: (await assertPublicUrl(baseUrl)).origin, email, jql, token: seal(token) };
		const source = await db.projectSource.create({ data: { projectId: project.id, type: 'jira', config, status: 'syncing' } });
		// Background: errors (bad token, bad JQL) land on the source, which the page polls.
		void syncSource(source.id);
		return c.json({ id: source.id }, 201);
	} catch (e) {
		// Private URL, or seal without SECRETS_KEY.
		return c.json({ error: 'invalid_jira', message: (e as Error).message }, 400);
	}
});

knowledge.post('/sources/:sid/sync', requireAuth, async (c) => {
	const source = await db.projectSource.findFirst({ where: { id: c.req.param('sid'), type: 'jira', project: { workspaceId: c.var.workspaceId } } });
	if (!source) return c.json({ error: 'not_found' }, 404);
	void syncSource(source.id);
	return c.body(null, 202);
});

// Repos leave a project via PATCH /projects/:id; this removes docs and Jira sources (and their chunks).
knowledge.delete('/projects/:id/sources/:sid', requireAuth, async (c) => {
	const source = await db.projectSource.findFirst({
		where: { id: c.req.param('sid'), projectId: c.req.param('id'), type: { in: ['doc', 'jira'] }, project: { workspaceId: c.var.workspaceId } },
		select: { id: true, type: true },
	});
	if (!source) return c.json({ error: 'not_found' }, 404);
	if (source.type === 'jira' && c.var.role !== 'owner') return forbidden(c);
	await db.projectSource.delete({ where: { id: source.id } });
	return c.body(null, 204);
});
