import { tool } from 'ai';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from './db';
import { repoDir, waitForSync } from './repos';

const TRUNCATED = '\n[truncado — refine o padrão]';
const MAX_GLOB = 500;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_BYTES = 16 * 1024;
const MAX_READ_LINES = 300;
const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Resolve `p` inside `root`, following symlinks; throws if it escapes (../, absolute, symlink out). */
export async function safePath(root: string, p: string) {
	const realRoot = await realpath(root);
	const real = await realpath(path.resolve(realRoot, p)).catch(() => {
		throw new Error(`arquivo não encontrado: ${p}`);
	});
	if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`caminho fora do repositório: ${p}`);
	return real;
}

type Repo = { id: string; fullName: string };

/**
 * Tools scoped to `repos` (already filtered by workspace). Errors come back as text
 * so the model can correct itself instead of the turn failing.
 */
export function agentTools(repos: Repo[]) {
	/** Looks up the repo, waits for any running sync and requires a ready clone. */
	async function open(fullName: string) {
		const repo = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
		if (!repo) throw new Error(`repo desconhecido: ${fullName}. Use list_repos.`);
		await waitForSync(repo.id);
		const branch = await db.repoBranch.findFirst({ where: { repositoryId: repo.id, status: 'ready' } });
		if (!branch) throw new Error(`${repo.fullName} ainda não foi sincronizado; tente de novo em instantes.`);
		return { root: repoDir(repo.id), sha: branch.lastSyncedSha?.slice(0, 7) };
	}

	const safe =
		<I>(fn: (input: I) => Promise<string>) =>
		(input: I) =>
			fn(input).catch((e: Error) => `erro: ${e.message}`);

	return {
		list_repos: tool({
			description: 'Lista os repositórios disponíveis, com branch, SHA sincronizado e status.',
			inputSchema: z.object({}),
			execute: async () => {
				const branches = await db.repoBranch.findMany({ where: { repositoryId: { in: repos.map((r) => r.id) } } });
				return repos
					.map((r) => {
						const b = branches.find((b) => b.repositoryId === r.id);
						return `${r.fullName} — ${b ? `${b.name}@${b.lastSyncedSha?.slice(0, 7) ?? '?'} (${b.status}${b.error ? `: ${b.error}` : ''})` : 'não sincronizado'}`;
					})
					.join('\n');
			},
		}),

		glob: tool({
			description: `Lista arquivos do repo por padrão glob (ex.: "src/**/*.ts"). Máx. ${MAX_GLOB} caminhos.`,
			inputSchema: z.object({ repo: z.string().describe('owner/name'), pattern: z.string() }),
			execute: safe(async ({ repo, pattern }) => {
				if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) throw new Error('padrão deve ser relativo ao repo');
				const { root } = await open(repo);
				const paths: string[] = [];
				for await (const p of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true, dot: true })) {
					const rel = p.replaceAll('\\', '/');
					if (rel === '.git' || rel.startsWith('.git/')) continue;
					if (paths.push(rel) >= MAX_GLOB) return paths.join('\n') + TRUNCATED;
				}
				return paths.join('\n') || 'nenhum arquivo';
			}),
		}),

		grep: tool({
			description: `Busca regex (PCRE) no conteúdo dos arquivos versionados. Retorna path:linha:texto. Máx. ${MAX_GREP_MATCHES} resultados.`,
			inputSchema: z.object({
				repo: z.string().describe('owner/name'),
				regex: z.string(),
				glob: z.string().optional().describe('filtra arquivos, ex.: "*.tsx"'),
			}),
			execute: safe(async ({ repo, regex, glob }) => {
				const { root } = await open(repo);
				// git grep: ships with git (no extra binary), only tracked files, -I skips binaries.
				// A glob without "/" matches at any depth, like ripgrep's --glob.
				const spec = glob ? [`:(glob)${glob.includes('/') ? glob : `**/${glob}`}`] : [];
				const args = ['git', 'grep', '-n', '-I', '-P', '--no-color', '--max-count=20', '-e', regex, '--', ...spec];
				const proc = Bun.spawn(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
				const timer = setTimeout(() => proc.kill(), 10_000);
				const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
				clearTimeout(timer);
				if (code === 1) return 'nenhum resultado';
				if (code !== 0) throw new Error(err.trim() || 'grep falhou');

				const lines = out
					.split('\n')
					.filter(Boolean)
					.map((l) => (l.length > 300 ? l.slice(0, 300) + '…' : l));
				const text = lines.slice(0, MAX_GREP_MATCHES).join('\n');
				const cut = lines.length > MAX_GREP_MATCHES || text.length > MAX_GREP_BYTES;
				return cut ? text.slice(0, MAX_GREP_BYTES) + TRUNCATED : text;
			}),
		}),

		read_file: tool({
			description: `Lê um arquivo do repo com números de linha. Máx. ${MAX_READ_LINES} linhas por chamada; use start/end para paginar.`,
			inputSchema: z.object({
				repo: z.string().describe('owner/name'),
				path: z.string(),
				start: z.number().int().min(1).optional(),
				end: z.number().int().min(1).optional(),
			}),
			execute: safe(async ({ repo, path: p, start = 1, end }) => {
				const { root, sha } = await open(repo);
				const file = await safePath(root, p);
				if ((await stat(file)).size > MAX_READ_BYTES) throw new Error('arquivo grande demais; use grep');
				const lines = (await readFile(file, 'utf8')).split('\n');
				const last = Math.min(end ?? lines.length, start + MAX_READ_LINES - 1, lines.length);
				const body = lines
					.slice(start - 1, last)
					.map((l, i) => `${start + i}\t${l}`)
					.join('\n');
				const more = last < lines.length ? `\n[linhas ${start}-${last} de ${lines.length}; peça start=${last + 1}]` : '';
				return `${repo}/${p}@${sha}\n${body}${more}`;
			}),
		}),
	};
}
