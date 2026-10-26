import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Hono } from 'hono';
import { z } from 'zod';
import { seal, unseal } from './apis';
import { requireAuth, requireOwner, type AuthVars } from './auth';
import { db } from './db';
import { env } from './env';

const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

const PROVIDERS = ['openrouter', 'mangaba'] as const;
type Provider = (typeof PROVIDERS)[number];
// mangaba-titan: 192k de contexto e tool calling; os outros modelos do Mangaba têm 8k–64k, pouco para o agente.
const DEFAULT_MODEL: Record<Provider, string> = { openrouter: env.LLM_MODEL, mangaba: 'mangaba-titan' };

const llmFields = { llmProvider: true, llmModel: true, mangabaApiKey: true } as const;

/** The workspace's agent LLM (Settings page). OpenRouter uses the server key; Mangaba the workspace's own. */
export async function workspaceLlm(workspaceId: string) {
	const w = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: llmFields });
	if (w.llmProvider === 'mangaba') {
		// PUT /settings only selects Mangaba with a key saved.
		if (!w.mangabaApiKey) throw new Error('chave do Mangaba não configurada');
		const model = w.llmModel ?? DEFAULT_MODEL.mangaba;
		const mangaba = createOpenAICompatible({
			name: 'mangaba',
			baseURL: env.MANGABA_BASE_URL,
			apiKey: unseal(w.mangabaApiKey),
			includeUsage: true,
		});
		return { provider: 'mangaba' as Provider, model, languageModel: mangaba(model) };
	}
	const model = w.llmModel ?? DEFAULT_MODEL.openrouter;
	// usage.include: OpenRouter devolve o custo (USD) de cada passo em providerMetadata.
	return { provider: 'openrouter' as Provider, model, languageModel: openrouter(model, { usage: { include: true } }) };
}

export const settings = new Hono<{ Variables: AuthVars }>();

settings.get('/settings', requireAuth, async (c) => {
	const w = await db.workspace.findUniqueOrThrow({ where: { id: c.var.workspaceId }, select: llmFields });
	return c.json({ provider: w.llmProvider, model: w.llmModel, hasMangabaKey: !!w.mangabaApiKey, defaultModels: DEFAULT_MODEL });
});

const update = z.object({
	provider: z.enum(PROVIDERS),
	// Vazio = padrão do provedor.
	model: z
		.string()
		.trim()
		.max(200)
		.transform((s) => s || null),
	// Vazio/ausente = mantém a chave salva.
	mangabaApiKey: z.string().trim().max(500).optional(),
});

settings.put('/settings', requireAuth, requireOwner, async (c) => {
	const body = update.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
	const { provider, model, mangabaApiKey } = body.data;
	const where = { id: c.var.workspaceId };

	const current = await db.workspace.findUniqueOrThrow({ where, select: { mangabaApiKey: true } });
	if (provider === 'mangaba' && !mangabaApiKey && !current.mangabaApiKey) {
		return c.json({ error: 'invalid_settings', message: 'Informe a chave do Mangaba Router.' }, 400);
	}
	if (mangabaApiKey) {
		// Só 401/403 barram: Mangaba fora do ar não impede salvar.
		const res = await fetch(`${env.MANGABA_BASE_URL}/models`, {
			headers: { authorization: `Bearer ${mangabaApiKey}` },
			signal: AbortSignal.timeout(10_000),
		}).catch(() => null);
		if (res?.status === 401 || res?.status === 403) {
			return c.json({ error: 'invalid_settings', message: 'Chave recusada pelo Mangaba Router.' }, 400);
		}
	}

	try {
		await db.workspace.update({
			where,
			data: { llmProvider: provider, llmModel: model, ...(mangabaApiKey && { mangabaApiKey: seal(mangabaApiKey) }) },
		});
	} catch (e) {
		// seal sem SECRETS_KEY.
		return c.json({ error: 'invalid_settings', message: (e as Error).message }, 400);
	}
	return c.body(null, 204);
});
