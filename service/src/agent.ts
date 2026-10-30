import { tool } from 'ai';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from './db';
import { installationOctokit } from './client';
import { env } from './env';
import { git, repoDir, run, syncRepo, waitForSync, zoektDir } from './repos';

const TRUNCATED = '\n[truncado — refine o padrão]';
const MAX_GLOB = 500;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_BYTES = 16 * 1024;
const MAX_READ_LINES = 300;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const GREP_TIMEOUT_MS = 10_000;
const MAX_COMMITS = 30;
const MAX_DIFF_BYTES = 16 * 1024;

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

/** Zoekt's query parser ends an atom at whitespace and opens a literal at `"`: hex escapes keep the regex intact. */
export const zoektAtom = (re: string) =>
	re.replace(/\\.|[\s"]/g, (m) => (/^\\?[\s"]$/.test(m) ? `\\x{${m.at(-1)!.charCodeAt(0).toString(16)}}` : m));

/** `path:line:text` for a Zoekt query on the repo's shards, or null when the repo has no shard yet. */
export async function zoektSearch(repoId: string, query: string) {
	// Index dir holds only this repo: whatever the query says, it can't search another workspace's code.
	const dir = zoektDir(repoId);
	const shards = await readdir(dir).catch(() => []);
	if (!shards.some((f) => f.endsWith('.zoekt'))) return null;
	// -v: without it the CLI discards its own error messages (bad regex comes back as a bare exit 1).
	// --: a query starting with "-" (e.g. "-index_dir=<other repo>") would otherwise be parsed as a flag.
	const { out, err, code } = await run(['zoekt', '-v', '-index_dir', dir, '--', query], { timeoutMs: GREP_TIMEOUT_MS });
	if (code !== 0) throw new Error(err.trim().split('\n').at(-1) || 'zoekt falhou');
	return out;
}

/** Agent's grep on Zoekt: null when the repo has no shard yet (caller falls back to git). */
const zoektGrep = (repoId: string, regex: string, glob?: string) =>
	zoektSearch(repoId, ['case:yes', glob && `f:${zoektAtom(globToRegex(glob))}`, `regex:${zoektAtom(regex)}`].filter(Boolean).join(' '));

/**
 * Lines of `p` in the SHA's tree. Object lookup, so "../", absolute paths and symlinks can't reach the host filesystem.
 * A trailing newline doesn't count as an extra line.
 */
export async function readBlob(root: string, sha: string, p: string): Promise<{ lines: string[] } | { error: 'tree' | 'missing' | 'too_large' }> {
	const rel = p.replaceAll('\\', '/').replace(/^\.?\/+/, '');
	// "<mode> <type> <object> <size>\t<path>\0" (-z: path unquoted); empty when the path isn't in the tree.
	const entry = await git(root, ['--literal-pathspecs', 'ls-tree', '-l', '-z', sha, '--', rel]).catch(() => '');
	const [, type, object, size] = entry.split(/\s+/);
	if (type === 'tree') return { error: 'tree' };
	if (type !== 'blob' || !object || !entry.endsWith(`\t${rel}\0`)) return { error: 'missing' };
	if (Number(size) > MAX_READ_BYTES) return { error: 'too_large' };
	const text = await git(root, ['cat-file', 'blob', object]);
	return { lines: (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n') };
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
	// Branch SHAs fixed on first use, for the whole turn: every tool and citation sees the same trees, even if a sync lands mid-turn.
	const pinned = new Map<string, { name: string; sha: string }[]>();

	function find(fullName: string) {
		const repo = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
		if (!repo) throw new Error(`repo desconhecido: ${fullName}. Use list_repos.`);
		return repo;
	}

	/** Octokit for the repo's installation: the shallow clone has no history, GitHub has. */
	async function github(fullName: string) {
		const { id, fullName: name } = find(fullName);
		const { installation } = await db.repository.findUniqueOrThrow({ where: { id }, include: { installation: true } });
		const [owner = '', repo = ''] = name.split('/');
		return { octokit: installationOctokit(Number(installation.githubInstallationId)), owner, repo };
	}

	/**
	 * Looks up the repo and the tree to read: `ref` = observed branch or sha; none = highest-priority branch (cascade top).
	 * Waits only when the first sync is still running.
	 */
	async function open(fullName: string, ref?: string) {
		const repo = find(fullName);
		const root = repoDir(repo.id);
		if (!pinned.has(repo.id)) {
			// Clone gone from disk while the DB still says synced (deploy without a volume, folder moved, another machine on
			// the same DB): every git call would fail with ENOENT, and nothing else re-syncs a 'ready' branch. Fetch it again first.
			if (!existsSync(path.join(root, 'HEAD'))) await syncRepo(repo.id);
			// Any status: during a re-sync (or after a failed one) the last synced SHA is still in the bare repo.
			const synced = () =>
				db.repoBranch.findMany({ where: { repositoryId: repo.id, lastSyncedSha: { not: null } }, orderBy: { priority: 'asc' } });
			let rows = await synced();
			if (!rows.length) rows = await waitForSync(repo.id).then(synced);
			if (!rows.length) {
				// Revoked (checkAccess) or every branch failed: say why instead of "try again".
				const failed = await db.repoBranch.findFirst({ where: { repositoryId: repo.id, status: 'error' }, select: { error: true } });
				throw new Error(`${repo.fullName} ${failed?.error ? `indisponível: ${failed.error}` : 'ainda não foi sincronizado; tente de novo em instantes.'}`);
			}
			pinned.set(
				repo.id,
				rows.map((b) => ({ name: b.name, sha: b.lastSyncedSha! }))
			);
		}
		const branches = pinned.get(repo.id)!;
		const branch = ref ? branches.find((b) => b.name === ref) : branches[0];
		const base = { id: repo.id, root, top: branch === branches[0] };
		if (branch) {
			const others = branches.filter((b) => b !== branch).map((b) => b.name);
			// Cascade hint for "not found": the agent looks in the next branches and says where it came from.
			const missing = (what: string) => `${what} em ${branch.name}${others.length ? `; outras branches, em ordem: ${others.join(', ')} (use ref)` : ''}`;
			return { ...base, sha: branch.sha, branch: branch.name, missing };
		}
		// A sha only resolves if the shallow fetches brought it (tips of observed branches, current or past).
		const sha = /^[0-9a-f]{7,40}$/i.test(ref!) ? (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')).trim() : '';
		if (!sha) throw new Error(`ref desconhecida: ${ref}. Branches sincronizadas, em ordem de prioridade: ${branches.map((b) => b.name).join(', ')}`);
		return { ...base, top: false, sha, branch: null, missing: (what: string) => `${what} em ${sha.slice(0, 7)}` };
	}

	const ref = z.string().optional().describe('branch observada ou sha; padrão: a branch de maior prioridade');

	const safe =
		<I>(fn: (input: I) => Promise<string>) =>
		(input: I) =>
			fn(input).catch((e: Error) => `erro: ${e.message}`);

	return {
		list_repos: tool({
			description: 'Lista os repositórios disponíveis com as branches observadas em ordem de prioridade, SHA sincronizado e status.',
			inputSchema: z.object({}),
			execute: async () => {
				const branches = await db.repoBranch.findMany({ where: { repositoryId: { in: repos.map((r) => r.id) } }, orderBy: { priority: 'asc' } });
				return repos
					.map((r) => {
						const own = branches
							.filter((b) => b.repositoryId === r.id)
							.map((b) => `${b.name}@${b.lastSyncedSha?.slice(0, 7) ?? '?'} (${b.status}${b.error ? `: ${b.error}` : ''})`);
						return `${r.fullName} — ${own.join(' → ') || 'não sincronizado'}`;
					})
					.join('\n');
			},
		}),

		glob: tool({
			description: `Lista arquivos do repo por padrão glob (ex.: "src/**/*.ts"). Máx. ${MAX_GLOB} caminhos.`,
			inputSchema: z.object({ repo: z.string().describe('owner/name'), pattern: z.string(), ref }),
			execute: safe(async ({ repo, pattern, ref }) => {
				const { root, sha, missing } = await open(repo, ref);
				const matcher = new Bun.Glob(pattern);
				const paths = (await git(root, ['ls-tree', '-r', '-z', '--name-only', sha])).split('\0').filter((p) => p && matcher.match(p));
				if (paths.length > MAX_GLOB) return paths.slice(0, MAX_GLOB).join('\n') + TRUNCATED;
				return paths.join('\n') || missing('nenhum arquivo');
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
				ref,
			}),
			execute: safe(async ({ repo, regex, glob, ref }) => {
				const { id, root, sha, top, missing } = await open(repo, ref);
				// Zoekt only indexes the top branch.
				const zoekt = env.GREP_BACKEND === 'zoekt' && top ? await zoektGrep(id, regex, glob) : null;
				const out = zoekt ?? (await gitGrep(root, sha, regex, glob));
				if (!out.trim()) return missing('nenhum resultado');

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
				ref,
			}),
			execute: safe(async ({ repo, path: p, start = 1, end, ref }) => {
				const { root, sha, branch, missing } = await open(repo, ref);
				const blob = await readBlob(root, sha, p);
				if ('error' in blob) {
					if (blob.error === 'tree') throw new Error(`${p} é um diretório; use glob`);
					if (blob.error === 'too_large') throw new Error('arquivo grande demais; use grep');
					throw new Error(missing(`arquivo não encontrado: ${p}`));
				}
				const { lines } = blob;
				const last = Math.min(end ?? lines.length, start + MAX_READ_LINES - 1, lines.length);
				const body = lines
					.slice(start - 1, last)
					.map((l, i) => `${start + i}\t${l}`)
					.join('\n');
				const more = last < lines.length ? `\n[linhas ${start}-${last} de ${lines.length}; peça start=${last + 1}]` : '';
				return `${repo}/${p}@${sha.slice(0, 7)}${branch ? ` · branch ${branch}` : ''}\n${body}${more}`;
			}),
		}),

		list_commits: tool({
			description: `Histórico de commits (API do GitHub), mais recentes primeiro: sha, data, autor e mensagem. Filtra por path e por período. Máx. ${MAX_COMMITS}.`,
			inputSchema: z.object({
				repo: z.string().describe('owner/name'),
				path: z.string().optional().describe('arquivo ou diretório'),
				ref: z.string().optional().describe('branch ou sha; padrão: o SHA que as outras tools leem'),
				since: z.string().optional().describe('ISO 8601, ex.: 2026-10-01T00:00:00Z'),
				until: z.string().optional().describe('ISO 8601'),
			}),
			execute: safe(async ({ repo, path: p, ref, since, until }) => {
				const { octokit, owner, repo: name } = await github(repo);
				const sha = ref ?? (await open(repo)).sha;
				const { data } = await octokit.rest.repos.listCommits({ owner, repo: name, sha, path: p, since, until, per_page: MAX_COMMITS });
				const line = (c: (typeof data)[number]) =>
					`${c.sha.slice(0, 7)} ${c.commit.author?.date?.slice(0, 10) ?? '?'} ${c.author?.login ?? c.commit.author?.name ?? '?'} — ${c.commit.message.split('\n')[0]}`;
				return data.map(line).join('\n') || 'nenhum commit';
			}),
		}),

		diff_refs: tool({
			description:
				'Diferença entre dois refs (branch, tag ou sha) via API do GitHub: commits de base até head, arquivos alterados e patches. Com list_commits responde "o que mudou desde X". path filtra arquivos pelo prefixo.',
			inputSchema: z.object({
				repo: z.string().describe('owner/name'),
				base: z.string(),
				head: z.string(),
				path: z.string().optional(),
			}),
			execute: safe(async ({ repo, base, head, path: p }) => {
				const { octokit, owner, repo: name } = await github(repo);
				const { data } = await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo: name, basehead: `${base}...${head}`, per_page: 100 });
				const files = (data.files ?? []).filter((f) => !p || f.filename.startsWith(p));
				const text = [
					`${base}...${head}: ${data.status}, ${data.ahead_by} commit(s) à frente, ${data.behind_by} atrás`,
					...data.commits.slice(-MAX_COMMITS).map((c) => `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`),
					'',
					...files.map((f) => `${f.status} ${f.filename} +${f.additions} -${f.deletions}`),
					...files.flatMap((f) => (f.patch ? ['', `--- ${f.filename}`, f.patch] : [])),
				].join('\n');
				return text.length > MAX_DIFF_BYTES ? text.slice(0, MAX_DIFF_BYTES) + TRUNCATED : text;
			}),
		}),
	};
}
