import { tool } from 'ai';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { db } from './db';
import { env } from './env';

const TRUNCATED = '\n[truncado — refine a busca]';
const MAX_OPERATIONS = 50;
const MAX_BYTES = 16 * 1024;
const CALL_TIMEOUT_MS = 15_000;
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// ---------- secrets (auth header) ----------

function key() {
	if (!env.SECRETS_KEY) throw new Error('SECRETS_KEY não configurada');
	return Buffer.from(env.SECRETS_KEY, 'base64');
}

// ponytail: só v1 (= SECRETS_KEY). Ao rotacionar: chave nova como v2, unseal escolhe pela versão, regravar os segredos.
const KEY_VERSION = 'v1';

/** AES-256-GCM; "v1.iv.tag.data" in base64. The version names the key, so SECRETS_KEY can be rotated. */
export function seal(text: string) {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key(), iv);
	const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
	return [KEY_VERSION, ...[iv, c.getAuthTag(), data].map((b) => b.toString('base64'))].join('.');
}

export function unseal(sealed: string) {
	const parts = sealed.split('.');
	// No prefix: sealed before versioning, same key as v1.
	const version = parts.length === 4 ? parts.shift() : KEY_VERSION;
	if (version !== KEY_VERSION) throw new Error(`versão de segredo desconhecida: ${version}`);
	const [iv, tag, data] = parts.map((b) => Buffer.from(b, 'base64'));
	if (parts.length !== 3 || !iv || !tag || !data) throw new Error('segredo corrompido');
	const d = createDecipheriv('aes-256-gcm', key(), iv);
	d.setAuthTag(tag);
	return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ---------- spec ----------

type Spec = { paths: Record<string, Record<string, Operation>> } & Record<string, unknown>;
type Operation = { summary?: string; description?: string; operationId?: string; tags?: string[] } & Record<string, unknown>;

/** OpenAPI 3 or Swagger 2, JSON or YAML. Throws if there are no paths. */
export function parseSpec(text: string): Spec {
	let spec: unknown;
	try {
		spec = JSON.parse(text);
	} catch {
		spec = Bun.YAML.parse(text);
	}
	const paths = (spec as Spec | null)?.paths;
	if (!paths || typeof paths !== 'object') throw new Error('spec sem "paths": envie um OpenAPI 3 ou Swagger 2');
	return spec as Spec;
}

function operations(spec: Spec) {
	return Object.entries(spec.paths).flatMap(([path, item]) =>
		Object.entries(item ?? {})
			.filter(([m]) => METHODS.includes(m))
			.map(([method, op]) => ({ method: method.toUpperCase(), path, op }))
	);
}

/** Resolves local $refs (#/components/..., #/definitions/...) up to `depth` levels. */
function deref(node: unknown, spec: Spec, depth = 4): unknown {
	if (Array.isArray(node)) return node.map((n) => deref(n, spec, depth));
	if (!node || typeof node !== 'object') return node;
	const ref = (node as { $ref?: unknown }).$ref;
	if (typeof ref === 'string') {
		if (!ref.startsWith('#/') || depth === 0) return node;
		const target = ref
			.slice(2)
			.split('/')
			.reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
		return deref(target, spec, depth - 1);
	}
	return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v, spec, depth)]));
}

export function searchOperations(spec: Spec, query = '') {
	const q = query.toLowerCase();
	const hits = operations(spec).filter(({ method, path, op }) =>
		[method, path, op.summary, op.description, op.operationId, ...(op.tags ?? [])].some((s) => s?.toLowerCase().includes(q))
	);
	const text = hits
		.slice(0, MAX_OPERATIONS)
		.map(({ method, path, op }) => `${method} ${path}${op.summary ? ` — ${op.summary}` : ''}`)
		.join('\n');
	return (text || 'nenhuma operação') + (hits.length > MAX_OPERATIONS ? TRUNCATED : '');
}

// ---------- SSRF ----------

/** Loopback, private, link-local, CGNAT, multicast/reserved, ULA and unspecified addresses, and v6 that carries a v4 inside. */
export function isPrivateIp(ip: string) {
	const v4 = ip.replace(/^::ffff:/i, '');
	if (isIP(v4) === 4) {
		const [a = 0, b = 0] = v4.split('.').map(Number);
		return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
	}
	// 0000::/16: ::, ::1 and the hex forms URL normalizes v4-mapped/compatible to ([::ffff:127.0.0.1] → ::ffff:7f00:1).
	// fc/fd ULA, ff multicast, fe8-feb link-local, 64:ff9b NAT64 and 2002 6to4 (both embed any v4).
	return /^0*:|^f[cdf]|^fe[89ab]|^64:ff9b:|^2002:/i.test(ip);
}

// ponytail: checks DNS before the fetch (rebinding window between lookup and connect); pin the resolved IP if it matters.
export async function assertPublicUrl(raw: string) {
	const url = new URL(raw);
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('URL precisa ser http(s)');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (addresses.some(isPrivateIp)) throw new Error('URL aponta para rede privada');
	return url;
}

/** `path` relative to baseUrl; refuses anything that would leave its origin/prefix. */
export function buildUrl(baseUrl: string, path: string, query: Record<string, string> = {}) {
	if (!path.startsWith('/') || path.startsWith('//') || path.split('/').includes('..')) throw new Error('path deve começar com / e ficar dentro da API');
	const base = new URL(baseUrl);
	const url = new URL(base.pathname.replace(/\/$/, '') + path, base.origin);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
	return url;
}

/** Body as text, reading only until it passes `max` bytes: a huge (or endless) response can't fill memory. */
export async function readCapped(res: Response, max: number) {
	const chunks: Uint8Array[] = [];
	let size = 0;
	// Leaving the for-await cancels the stream.
	for await (const chunk of res.body ?? []) {
		chunks.push(chunk);
		if ((size += chunk.length) > max) break;
	}
	return Buffer.concat(chunks).toString('utf8');
}

// ---------- tools ----------

type Api = { id: string; title: string; baseUrl: string | null };

/**
 * Tools over the project's API specs (already filtered by workspace). Read-only: call_api is GET only,
 * so a prompt injection in code or in an API response can't change anything with the user's credentials.
 */
export function apiTools(apis: Api[], audit: { workspaceId: string; userId: string; conversationId: string }) {
	const specs = new Map<string, Promise<{ spec: Spec; authHeader: string | null }>>();

	function find(id: string) {
		const api = apis.find((a) => a.id === id);
		if (!api) throw new Error(`API desconhecida: ${id}. Use os ids da lista de APIs.`);
		return api;
	}
	// Specs can be MBs: load on first use, once per turn.
	function load(id: string) {
		if (!specs.has(id))
			specs.set(
				id,
				db.apiSpec.findUniqueOrThrow({ where: { id }, select: { spec: true, authHeader: true } }).then((r) => ({ spec: r.spec as Spec, authHeader: r.authHeader }))
			);
		return specs.get(id)!;
	}
	const safe =
		<I>(fn: (input: I) => Promise<string>) =>
		(input: I) =>
			fn(input).catch((e: Error) => `erro: ${e.message}`);

	return {
		search_api: tool({
			description: `Lista operações de uma API (spec OpenAPI/Swagger) filtrando por texto no path, resumo, tags ou operationId. Sem query lista todas. Máx. ${MAX_OPERATIONS}.`,
			inputSchema: z.object({ api: z.string().describe('id da API'), query: z.string().optional() }),
			execute: safe(async ({ api, query }) => searchOperations((await load(find(api).id)).spec, query)),
		}),

		describe_api_operation: tool({
			description: 'Detalha uma operação da spec: parâmetros, corpo e respostas (com $ref resolvido).',
			inputSchema: z.object({ api: z.string().describe('id da API'), method: z.string(), path: z.string().describe('path exatamente como na spec, ex.: /users/{id}') }),
			execute: safe(async ({ api, method, path }) => {
				const { spec } = await load(find(api).id);
				const op = spec.paths[path]?.[method.toLowerCase()];
				if (!op) throw new Error(`operação não encontrada: ${method} ${path}. Use search_api.`);
				const shared = (spec.paths[path] as { parameters?: unknown }).parameters;
				const text = JSON.stringify(deref({ ...(shared ? { parameters: shared } : {}), ...op }, spec), null, 1);
				return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) + TRUNCATED : text;
			}),
		}),

		call_api: tool({
			description: 'Faz um GET real na API (dados ao vivo: métricas, status, logs). Só leitura. path relativo à baseUrl, com parâmetros de path já preenchidos.',
			inputSchema: z.object({
				api: z.string().describe('id da API'),
				path: z.string().describe('ex.: /api/v1/query'),
				query: z.record(z.string(), z.string()).optional(),
			}),
			execute: safe(async ({ api, path, query }) => {
				const started = Date.now();
				// Audit: one line per call, blocked ones included, in the platform logs (Message.parts can be deleted with the conversation).
				const log = (outcome: { status: number } | { error: string }) =>
					console.info('[call_api]', JSON.stringify({ ...audit, api, path, query, ms: Date.now() - started, ...outcome }));
				try {
					const a = find(api);
					if (!a.baseUrl) throw new Error(`${a.title} não tem baseUrl: só documentação, não dá para chamar.`);
					const url = buildUrl(a.baseUrl, path, query);
					await assertPublicUrl(url.href);
					const { authHeader } = await load(a.id);
					const headers: Record<string, string> = { Accept: 'application/json' };
					if (authHeader) {
						const [name = '', ...value] = unseal(authHeader).split(':');
						headers[name.trim()] = value.join(':').trim();
					}
					// redirect: 'manual' — a 3xx to an internal host would bypass the SSRF check.
					const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
					const body = await readCapped(res, MAX_BYTES);
					log({ status: res.status });
					const text = `GET ${url.pathname}${url.search} → ${res.status}\n${body}`;
					return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) + TRUNCATED : text;
				} catch (e) {
					log({ error: (e as Error).message });
					throw e;
				}
			}),
		}),
	};
}
