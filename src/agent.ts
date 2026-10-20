import { tool } from 'ai';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { db } from './db';
import { env } from './env';
import { git, repoDir, run, waitForSync, zoektDir } from './repos';

const TRUNCATED = '\n[truncado — refine o padrão]';
const MAX_GLOB = 500;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_BYTES = 16 * 1024;
const MAX_READ_LINES = 300;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const GREP_TIMEOUT_MS = 10_000;

/** Glob → anchored regex, same semantics as git's :(glob) pathspec. No "/" → any depth, like ripgrep's --glob. */
export function globToRegex(glob: string) {
	const g = glob.includes('/') ? glob : `**/${glob}`;
	let re = '';
	let braces = 0;
	for (let i = 0; i < g.length; i++) {
		const c = g[i]!;
		if (g.startsWith('**/', i)) {
			re += '(?:.*/)?';
			i += 2;
		} else if (g.startsWith('**', i)) {
			re += '.*';
			i += 1;
		} else if (c === '*') re += '[^/]*';
		else if (c === '?') re += '[^/]';
		else if (c === '{') {
			re += '(?:';
			braces++;
		} else if (c === '}' && braces) {
			re += ')';
			braces--;
		} else if (c === ',' && braces) re += '|';
		else re += c.replace(/[.+^$()|\\{}]/, '\\$&');
	}
	return `^${re}$`;
}

/** Zoekt's query parser ends an atom at a space and opens a literal at `"`: hex escapes keep the regex intact. */
export const zoektAtom = (re: string) =>
	re.replace(/\\.|[ "]/g, (m) => (/^\\?[ "]$/.test(m) ? `\\x${m.at(-1)!.charCodeAt(0).toString(16)}` : m));

/** `path:line:text` from the repo's Zoekt shards, or null when the repo has no shard yet (caller falls back to git). */
async function zoektGrep(repoId: string, regex: string, glob?: string) {
	const shards = await readdir(zoektDir).catch(() => []);
	if (!shards.some((f) => f.startsWith(`${repoId}_`))) return null;
	const q = ['case:yes', `r:^${repoId}$`, glob && `f:${zoektAtom(globToRegex(glob))}`, `regex:${zoektAtom(regex)}`].filter(Boolean).join(' ');
	// -v: without it the CLI discards its own error messages (bad regex comes back as a bare exit 1).
	const { out, err, code } = await run(['zoekt', '-v', '-index_dir', zoektDir, q], { timeoutMs: GREP_TIMEOUT_MS });
	if (code !== 0) throw new Error(err.trim().split('\n').at(-1) || 'zoekt falhou');
	return out;
}

/** `path:line:text` via git grep on the SHA's tree. */
async function gitGrep(root: string, sha: string, regex: string, glob?: string) {
	// A glob without "/" matches at any depth, like ripgrep's --glob.
	const spec = glob ? [`:(glob)${glob.includes('/') ? glob : `**/${glob}`}`] : [];
	const args = ['git', 'grep', '-n', '-I', '-P', '--no-color', '--max-count=20', '-e', regex, sha, '--', ...spec];
	const { out, err, code } = await run(args, { cwd: root, timeoutMs: GREP_TIMEOUT_MS });
	if (code === 1) return '';
	if (code !== 0) throw new Error(err.trim() || 'grep falhou');
	// Grepping a tree prefixes every line with "<sha>:".
	return out.replace(new RegExp(`^${sha}:`, 'gm'), '');
}

type Repo = { id: string; fullName: string };

/**
 * Tools scoped to `repos` (already filtered by workspace). Errors come back as text
 * so the model can correct itself instead of the turn failing.
 */
export function agentTools(repos: Repo[]) {
	// SHA fixed on first use, for the whole turn: every tool and citation sees the same tree, even if a sync lands mid-turn.
	const pinned = new Map<string, string>();

	/** Looks up the repo and its synced SHA; waits only when the first sync is still running. */
	async function open(fullName: string) {
		const repo = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
		if (!repo) throw new Error(`repo desconhecido: ${fullName}. Use list_repos.`);
		if (!pinned.has(repo.id)) {
			// Any status: during a re-sync (or after a failed one) the last synced SHA is still in the bare repo.
			const synced = () =>
				db.repoBranch.findFirst({ where: { repositoryId: repo.id, lastSyncedSha: { not: null } }, orderBy: { priority: 'asc' } });
			const branch = (await synced()) ?? (await waitForSync(repo.id).then(synced));
			if (!branch?.lastSyncedSha) throw new Error(`${repo.fullName} ainda não foi sincronizado; tente de novo em instantes.`);
			pinned.set(repo.id, branch.lastSyncedSha);
		}
		return { id: repo.id, root: repoDir(repo.id), sha: pinned.get(repo.id)! };
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
				const { root, sha } = await open(repo);
				const matcher = new Bun.Glob(pattern);
				const paths = (await git(root, ['ls-tree', '-r', '-z', '--name-only', sha])).split('\0').filter((p) => p && matcher.match(p));
				if (paths.length > MAX_GLOB) return paths.slice(0, MAX_GLOB).join('\n') + TRUNCATED;
				return paths.join('\n') || 'nenhum arquivo';
			}),
		}),

		grep: tool({
			description:
				env.GREP_BACKEND === 'zoekt'
					? `Busca regex (RE2: sem lookaround nem backreference) no conteúdo dos arquivos versionados, mais relevantes primeiro. Retorna path:linha:texto. Máx. ${MAX_GREP_MATCHES} resultados.`
					: `Busca regex (PCRE) no conteúdo dos arquivos versionados. Retorna path:linha:texto. Máx. ${MAX_GREP_MATCHES} resultados.`,
			inputSchema: z.object({
				repo: z.string().describe('owner/name'),
				regex: z.string(),
				glob: z.string().optional().describe('filtra arquivos, ex.: "*.tsx"'),
			}),
			execute: safe(async ({ repo, regex, glob }) => {
				const { id, root, sha } = await open(repo);
				const zoekt = env.GREP_BACKEND === 'zoekt' ? await zoektGrep(id, regex, glob) : null;
				const out = zoekt ?? (await gitGrep(root, sha, regex, glob));
				if (!out.trim()) return 'nenhum resultado';

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
				// Object lookup in the SHA's tree: "../", absolute paths and symlinks can't reach the host filesystem.
				const rel = p.replaceAll('\\', '/').replace(/^\.?\/+/, '');
				// "<mode> <type> <object> <size>\t<path>\0" (-z: path unquoted); empty when the path isn't in the tree.
				const entry = await git(root, ['--literal-pathspecs', 'ls-tree', '-l', '-z', sha, '--', rel]).catch(() => '');
				const [, type, object, size] = entry.split(/\s+/);
				if (type === 'tree') throw new Error(`${p} é um diretório; use glob`);
				if (type !== 'blob' || !entry.endsWith(`\t${rel}\0`)) throw new Error(`arquivo não encontrado: ${p}`);
				if (Number(size) > MAX_READ_BYTES) throw new Error('arquivo grande demais; use grep');

				const lines = (await git(root, ['cat-file', 'blob', object!])).split('\n');
				const last = Math.min(end ?? lines.length, start + MAX_READ_LINES - 1, lines.length);
				const body = lines
					.slice(start - 1, last)
					.map((l, i) => `${start + i}\t${l}`)
					.join('\n');
				const more = last < lines.length ? `\n[linhas ${start}-${last} de ${lines.length}; peça start=${last + 1}]` : '';
				return `${repo}/${p}@${sha.slice(0, 7)}\n${body}${more}`;
			}),
		}),
	};
}
