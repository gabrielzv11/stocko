import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { installationOctokit, installationToken } from './client';
import { db } from './db';
import { env } from './env';

/** Bare repo: tools read objects by SHA (ls-tree / grep / cat-file), no checkout on disk. */
export const repoDir = (repositoryId: string) => path.resolve(env.REPOS_DIR, repositoryId);
/** Zoekt shards of one repo, inside its bare repo: a query can only reach that repo's code, and removing the repo removes them. */
export const zoektDir = (repositoryId: string) => path.join(repoDir(repositoryId), 'zoekt');

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

// ponytail: in-process dedupe (1 réplica); Inngest (concorrência 1 por repo, retry) se houver várias réplicas.
const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Observed branches a repo can have (cascade in the agent's tools). */
export const MAX_BRANCHES = 5;

/**
 * Fetch every observed branch into the repo's bare repo. One run per repo at a time; a call during a run
 * (push, new branch) queues one more pass, so the state requested now isn't lost. Never rejects.
 */
export function syncRepo(repositoryId: string): Promise<void> {
	const running = inflight.get(repositoryId);
	if (running) {
		again.add(repositoryId);
		return running;
	}
	const pending = (async () => {
		do {
			again.delete(repositoryId);
			// Repo removed meanwhile (webhook) → findUniqueOrThrow throws; callers fire and forget.
			await doSync(repositoryId).catch((e) => console.error(`[sync] ${repositoryId}:`, e));
		} while (again.has(repositoryId));
	})().finally(() => inflight.delete(repositoryId));
	inflight.set(repositoryId, pending);
	return pending;
}

/** Deletes the repository (cascade: branches, project sources) and its clone with its Zoekt shards. */
export async function removeRepo(repositoryId: string) {
	await db.repository.deleteMany({ where: { id: repositoryId } });
	await rm(repoDir(repositoryId), { recursive: true, force: true });
}

/** Old layout: one Zoekt index shared by every repo, so a crafted query could search other workspaces. Re-indexed per repo on the next sync. */
// ponytail: remove once every deploy has booted past it.
export const removeSharedZoekt = () => rm(path.resolve(env.REPOS_DIR, '.zoekt'), { recursive: true, force: true });

const ACCESS_TTL_MS = 10 * 60_000;
const accessCheckedAt = new Map<string, number>();
export const REVOKED = 'Sem acesso no GitHub: repo removido da App, App desinstalada ou repo apagado.';

/**
 * Whether the App still reaches the repo on GitHub. Lost (404) → clone deleted and branches marked, so no tool reads
 * code the workspace can't see anymore; the Repository row stays and a later sync re-clones if access comes back.
 * Doesn't rely on the webhook. Any other failure (rate limit, outage) counts as access: only a 404 revokes.
 * Checked at most every ACCESS_TTL_MS per repo, unless `fresh`.
 */
export async function checkAccess(repositoryId: string, { fresh = false } = {}) {
	if (!fresh && (accessCheckedAt.get(repositoryId) ?? 0) > Date.now() - ACCESS_TTL_MS) return true;
	const repo = await db.repository.findUnique({ where: { id: repositoryId }, include: { installation: true } });
	if (!repo) return false;
	const [owner = '', name = ''] = repo.fullName.split('/');
	const status = await installationOctokit(Number(repo.installation.githubInstallationId))
		.rest.repos.get({ owner, repo: name })
		.then(
			() => 200,
			(e: { status?: number }) => e.status
		);
	if (status !== 404) {
		accessCheckedAt.set(repositoryId, Date.now());
		return true;
	}
	accessCheckedAt.delete(repositoryId);
	await rm(repoDir(repositoryId), { recursive: true, force: true });
	await db.repoBranch.updateMany({ where: { repositoryId }, data: { status: 'error', error: REVOKED, lastSyncedSha: null } });
	return false;
}

/**
 * Commits that left the observed branches (force-push removing a leaked secret, branch no longer observed) leave the
 * disk now instead of in 2 weeks, so no tool reads them by sha. A tool mid-turn on the old sha gets "not found".
 */
export async function pruneUnobserved(dir: string, branchNames: string[]) {
	const observed = new Set(branchNames.map((b) => `refs/heads/${b}`));
	const refs = (await git(dir, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).split('\n').filter(Boolean);
	for (const ref of refs) if (!observed.has(ref)) await git(dir, ['update-ref', '-d', ref]);
	await git(dir, ['gc', '--prune=now', '--quiet']);
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
	// Fresh: about to talk to GitHub anyway; access lost → clone deleted, nothing to fetch.
	if (!(await checkAccess(repositoryId, { fresh: true }))) return;
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
	await pruneUnobserved(
		dir,
		branches.map((b) => b.name)
	).catch((e) => console.error(`[sync] ${repo.fullName} gc:`, e));
	if (env.GREP_BACKEND === 'zoekt') {
		// Incremental: no-op when the branch didn't move. -disable_ctags: no ctags binary in the image.
		// Spawn throws when the binary is missing (local Windows dev); same outcome as a failed index.
		// ponytail: só a branch do topo é indexada; grep com ref de outra branch usa git grep.
		const idx = await run(['zoekt-git-index', '-index', zoektDir(repositoryId), '-branches', top, '-submodules=false', '-disable_ctags', dir]).catch(
			(e: Error) => ({ code: -1, err: e.message })
		);
		// ponytail: falha no índice só loga; o grep cai no git grep enquanto não houver shard do repo.
		if (idx.code !== 0) console.error(`[zoekt] ${repo.fullName}:`, idx.err.trim());
	}
}

/**
 * Kick a background sync for repos never synced or with a pending branch (sync cut by a restart). Doesn't wait.
 * Updates come only from the push webhook or the manual sync: no re-sync by age.
 */
export async function syncPending(repositoryIds: string[]) {
	const branches = await db.repoBranch.findMany({ where: { repositoryId: { in: repositoryIds } } });
	for (const id of repositoryIds) {
		const own = branches.filter((b) => b.repositoryId === id);
		if (!own.length || own.some((b) => b.status === 'pending')) void syncRepo(id);
	}
}

/** Syncs interrupted by a restart would stay 'syncing' forever. */
export const resetStuckSyncs = () => db.repoBranch.updateMany({ where: { status: 'syncing' }, data: { status: 'pending' } });
