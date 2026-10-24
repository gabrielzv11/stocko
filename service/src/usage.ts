import { Hono } from 'hono';
import { requireAuth, type AuthVars } from './auth';
import { db } from './db';

const DAYS = 30;

type Sum = { cost: number; inputTokens: number; outputTokens: number; cachedTokens: number; turns: number };
const empty = (): Sum => ({ cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, turns: 0 });

function add(map: Map<string, Sum>, key: string, m: { cost: unknown; inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null }) {
	const s = map.get(key) ?? empty();
	s.cost += Number(m.cost ?? 0);
	s.inputTokens += m.inputTokens ?? 0;
	s.outputTokens += m.outputTokens ?? 0;
	s.cachedTokens += m.cachedTokens ?? 0;
	s.turns += 1;
	map.set(key, s);
}

const sorted = (map: Map<string, Sum>) => [...map].map(([key, s]) => ({ key, ...s })).sort((a, b) => b.cost - a.cost);

export const usage = new Hono<{ Variables: AuthVars }>();

/** LLM spend (cost only from OpenRouter) of the workspace's agent turns in the last DAYS days. `tz` (IANA) buckets the days. */
usage.get('/usage', requireAuth, async (c) => {
	let timeZone = c.req.query('tz') || 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone });
	} catch {
		timeZone = 'UTC';
	}
	const day = new Intl.DateTimeFormat('sv-SE', { timeZone }); // sv-SE formats as YYYY-MM-DD
	const since = new Date(Date.now() - DAYS * 86_400_000);

	// ponytail: agrega em JS (1 query); trocar por GROUP BY no SQL se o volume de mensagens crescer.
	const messages = await db.message.findMany({
		where: { role: 'assistant', createdAt: { gte: since }, conversation: { workspaceId: c.var.workspaceId } },
		select: {
			createdAt: true,
			model: true,
			cost: true,
			inputTokens: true,
			outputTokens: true,
			cachedTokens: true,
			conversation: { select: { id: true, title: true, projects: { select: { id: true, name: true } } } },
		},
	});

	const total = new Map<string, Sum>();
	const byDay = new Map<string, Sum>();
	const byModel = new Map<string, Sum>();
	const byProject = new Map<string, Sum>();
	const byConversation = new Map<string, Sum>();
	const names = new Map<string, string>();

	for (const m of messages) {
		add(total, 'total', m);
		add(byDay, day.format(m.createdAt), m);
		add(byModel, m.model ?? 'desconhecido', m);
		add(byConversation, m.conversation.id, m);
		names.set(m.conversation.id, m.conversation.title ?? 'Sem título');
		// Conversa ligada a N projetos conta em cada um.
		for (const p of m.conversation.projects) {
			add(byProject, p.id, m);
			names.set(p.id, p.name);
		}
	}

	return c.json({
		since: since.toISOString(),
		days: DAYS,
		totals: total.get('total') ?? empty(),
		byDay: [...byDay].map(([day, s]) => ({ day, ...s })).sort((a, b) => a.day.localeCompare(b.day)),
		byModel: sorted(byModel).map(({ key, ...s }) => ({ model: key, ...s })),
		byProject: sorted(byProject).map(({ key, ...s }) => ({ id: key, name: names.get(key)!, ...s })),
		byConversation: sorted(byConversation)
			.slice(0, 10)
			.map(({ key, ...s }) => ({ id: key, title: names.get(key)!, ...s })),
	});
});
