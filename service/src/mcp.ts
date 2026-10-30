import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticate, logged, type Key, type Usage } from './keys';
import { MAX_READ_LINES, MAX_SEARCH_RESULTS, QueryError, ask, listProjects, readFile, searchCode, type ErrorCode } from './query';

const MAX_QUESTION = 20_000;

const json = (data: unknown, isError = false): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError });

/** Tools bound to the caller's key: every call is rate-limited and logged, errors come back with a stable code. */
function server(key: Key) {
	const scope = { workspaceId: key.workspaceId };
	const call = <T>(tool: string, projectId: string | undefined, fn: () => Promise<{ output: T; usage?: Usage }>) =>
		logged(key, tool, projectId, fn).then(
			(output) => json(output),
			(e: unknown) => {
				if (e instanceof QueryError) return json({ error: e.code, message: e.message }, true);
				console.error(`[mcp] ${tool}:`, e);
				return json({ error: 'INTERNAL' satisfies ErrorCode, message: 'erro interno' }, true);
			}
		);

	const s = new McpServer({ name: 'stocko', version: '1.0.0' });
	const readOnly = { readOnlyHint: true, openWorldHint: false };
	const project = z.string().min(1).max(64).describe('id do projeto (veja list_projects)');
	const repo = z.string().min(3).max(200).optional().describe('owner/name; obrigatório quando o projeto tem mais de um repositório');

	s.registerTool(
		'list_projects',
		{
			description: 'Projetos acessíveis por esta chave, com os repositórios e o commit indexado de cada um (indexedSha, indexedAt).',
			inputSchema: {},
			annotations: readOnly,
		},
		() => call('list_projects', undefined, async () => ({ output: await listProjects(scope) }))
	);

	s.registerTool(
		'search_code',
		{
			description: `Busca no código indexado com a sintaxe de query do Zoekt (regex, "f:caminho", "lang:go", "case:yes", "-f:test"...). Resultados mais relevantes primeiro: path, linha e trecho. Máx. ${MAX_SEARCH_RESULTS}.`,
			inputSchema: { project, repo, query: z.string().min(1).max(1000), limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20) },
			annotations: readOnly,
		},
		(input) => call('search_code', input.project, async () => ({ output: await searchCode(scope, input) }))
	);

	s.registerTool(
		'read_file',
		{
			description: `Lê um arquivo no commit indexado. Máx. ${MAX_READ_LINES} linhas por chamada; truncated=true indica que veio menos do que o pedido (continue com startLine=endLine+1).`,
			inputSchema: {
				project,
				repo,
				path: z.string().min(1).max(1000).describe('caminho relativo à raiz do repositório'),
				startLine: z.number().int().min(1).optional(),
				endLine: z.number().int().min(1).optional(),
			},
			annotations: readOnly,
		},
		(input) => call('read_file', input.project, async () => ({ output: await readFile(scope, input) }))
	);

	s.registerTool(
		'ask',
		{
			description:
				'Pergunta em linguagem natural respondida por um agente que lê o código do repositório. Cada afirmação vem com citação (path e linhas); sem evidência, a resposta diz que não encontrou. Lento e com custo de LLM: prefira search_code e read_file quando bastarem.',
			inputSchema: { project, repo, question: z.string().trim().min(1).max(MAX_QUESTION) },
			annotations: readOnly,
		},
		(input) => call('ask', input.project, () => ask(scope, input))
	);

	return s;
}

export const mcp = new Hono();

// Streamable HTTP, stateless: a fresh server per request, JSON responses, no sessions to keep between replicas or restarts.
mcp.all('/mcp', async (c) => {
	const key = await authenticate(c.req.header('Authorization'));
	if (!key) return c.json({ error: 'UNAUTHORIZED' satisfies ErrorCode, message: 'Chave de API ausente, inválida ou revogada.' }, 401);
	const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 1024 * 1024 });
	await server(key).connect(transport);
	return transport.handleRequest(c.req.raw);
});
