import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { installationToken } from './client';
import { db } from './db';
import { env } from './env';

/** Bare repo: tools read objects by SHA (ls-tree / grep / cat-file), no checkout on disk. */
export const repoDir = (repositoryId: string) => path.resolve(env.REPOS_DIR, repositoryId);
/** Zoekt shards, on the same volume. Shard names start with the repo id (= the bare dir's name). */
export const zoektDir = path.resolve(env.REPOS_DIR, '.zoekt');

/** Spawns `cmd` and collects its output; `timeoutMs` kills it. */
export async function run(cmd: string[], { cwd, env: extra, timeoutMs }: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
	const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...extra }, stdout: 'pipe', stderr: 'pipe' });
	const timer = timeoutMs ? setTimeout(() => proc.kill(), timeoutMs) : undefined;
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	clearTimeout(timer);
	return { out, err, code };
}

/** Runs git in `dir`; the token goes in an env-provided header, never in the remote URL / config. */
export async function git(dir: string, args: string[], token?: string) {
	const auth = token && {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.extraHeader',
		GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
	};
	const { out, err, code } = await run(['git', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0', ...auth } });
	if (code !== 0) throw new Error(err.trim() || `git ${args[0]} saiu com ${code}`);
	return out;
}

// ponytail: in-process dedupe (1 réplica); Inngest (concorrência 1 por repo, retry) quando houver webhooks/cron.
const inflight = new Map<string, Promise<void>>();

/** Observed branches a repo can have (cascade in the agent's tools). */
export const MAX_BRANCHES = 5;

/** Fetch every observed branch into the repo's bare repo. Concurrent calls share one run. */
export function syncRepo(repositoryId: string): Promise<void> {
	let pending = inflight.get(repositoryId);
	if (!pending) {
		pending = doSync(repositoryId).finally(() => inflight.delete(repositoryId));
		inflight.set(repositoryId, pending);
	}
	return pending;
}

/** Resolves when the running sync (if any) ends. Tools only need it before the first one. */
export const waitForSync = (repositoryId: string) => inflight.get(repositoryId) ?? Promise.resolve();

async function doSync(repositoryId: string) {
	const repo = await db.repository.findUniqueOrThrow({
		where: { id: repositoryId },
		include: { installation: true, branches: { orderBy: { priority: 'asc' } } },
	});
	// First sync: the default branch is the first observed one.
	const branches = repo.branches.length
		? repo.branches
		: [await db.repoBranch.create({ data: { repositoryId, name: repo.defaultBranch, priority: 0 } })];
	// updateMany: a branch removed mid-sync just matches nothing.
	const mark = (ids: string[], data: { status: 'syncing' | 'ready' | 'error'; error?: string | null; lastSyncedSha?: string }) =>
		db.repoBranch.updateMany({ where: { id: { in: ids } }, data });
	await mark(
		branches.map((b) => b.id),
		{ status: 'syncing', error: null }
	);

	const dir = repoDir(repositoryId);
	const url = `https://github.com/${repo.fullName}.git`;
	let token: string;
	try {
		if ((repo.sizeKb ?? 0) > env.MAX_REPO_SIZE_MB * 1024) throw new Error(`repo maior que ${env.MAX_REPO_SIZE_MB} MB`);
		token = await installationToken(Number(repo.installation.githubInstallationId));
		// Old layout (checkout with .git inside) → start over as bare.
		if (existsSync(path.join(dir, '.git'))) await rm(dir, { recursive: true, force: true });
		if (!existsSync(path.join(dir, 'HEAD'))) {
			await mkdir(dir, { recursive: true });
			await git(dir, ['init', '--bare', '--quiet']);
		}
	} catch (e) {
		await mark(
			branches.map((b) => b.id),
			{ status: 'error', error: (e as Error).message.slice(0, 500) }
		);
		console.error(`[sync] ${repo.fullName}:`, e);
		return;
	}

	// One fetch per branch: one deleted on GitHub doesn't block the others.
	const ready: string[] = [];
	for (const b of branches) {
		const ref = `refs/heads/${b.name}`;
		try {
			// Fetch only adds objects: an older SHA a tool is reading stays readable (until gc prunes it, 2 weeks).
			await git(dir, ['fetch', '--depth=1', '--quiet', url, `+${ref}:${ref}`], token);
			const sha = (await git(dir, ['rev-parse', ref])).trim();
			await mark([b.id], { status: 'ready', lastSyncedSha: sha });
			ready.push(b.name);
		} catch (e) {
			await mark([b.id], { status: 'error', error: (e as Error).message.slice(0, 500) });
			console.error(`[sync] ${repo.fullName}@${b.name}:`, e);
		}
	}

	// Default ref of the tools (and of Zoekt) = highest-priority branch that synced.
	const top = ready[0];
	if (!top) return;
	await git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${top}`]);
	if (env.GREP_BACKEND === 'zoekt') {
		// Incremental: no-op when the branch didn't move. -disable_ctags: no ctags binary in the image.
		// Spawn throws when the binary is missing (local Windows dev); same outcome as a failed index.
		// ponytail: só a branch do topo é indexada; grep com ref de outra branch usa git grep.
		const idx = await run(['zoekt-git-index', '-index', zoektDir, '-branches', top, '-submodules=false', '-disable_ctags', dir]).catch(
			(e: Error) => ({ code: -1, err: e.message })
		);
		// ponytail: falha no índice só loga; o grep cai no git grep enquanto não houver shard do repo.
		if (idx.code !== 0) console.error(`[zoekt] ${repo.fullName}:`, idx.err.trim());
	}
}

// ponytail: re-sync por idade a cada chat; webhook push + cron de reconciliação substituem isso.
const STALE_MS = 10 * 60_000;

/** Kick a background sync for repos never synced, pending, or with a branch older than STALE_MS (failed ones too). Doesn't wait. */
export async function refreshStale(repositoryIds: string[]) {
	const branches = await db.repoBranch.findMany({ where: { repositoryId: { in: repositoryIds } } });
	for (const id of repositoryIds) {
		const own = branches.filter((b) => b.repositoryId === id);
		const stale = own.some((b) => b.status === 'pending' || (b.status !== 'syncing' && Date.now() - b.updatedAt.getTime() > STALE_MS));
		if (!own.length || stale) void syncRepo(id);
	}
}

/** Syncs interrupted by a restart would stay 'syncing' forever. */
export const resetStuckSyncs = () => db.repoBranch.updateMany({ where: { status: 'syncing' }, data: { status: 'pending' } });
