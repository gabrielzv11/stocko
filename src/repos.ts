import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { installationToken } from './client';
import { db } from './db';
import { env } from './env';

export const repoDir = (repositoryId: string) => path.resolve(env.REPOS_DIR, repositoryId);

/** Runs git; the token goes in an env-provided header, never in the remote URL / .git/config. */
async function git(args: string[], token?: string) {
	const auth = token && {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.extraHeader',
		GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
	};
	const proc = Bun.spawn(['git', ...args], {
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...auth },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new Error(err.trim() || `git ${args[0]} saiu com ${code}`);
	return out.trim();
}

// ponytail: in-process dedupe + lock (1 réplica); Inngest (concorrência 1 por repo, retry) quando houver webhooks/cron.
const inflight = new Map<string, Promise<void>>();

/** Clone or fast-forward the repo's default branch. Concurrent calls share one run. */
export function syncRepo(repositoryId: string): Promise<void> {
	let run = inflight.get(repositoryId);
	if (!run) {
		run = doSync(repositoryId).finally(() => inflight.delete(repositoryId));
		inflight.set(repositoryId, run);
	}
	return run;
}

/** Tools call this before touching the clone so they never read mid-sync. */
export const waitForSync = (repositoryId: string) => inflight.get(repositoryId) ?? Promise.resolve();

async function doSync(repositoryId: string) {
	const repo = await db.repository.findUniqueOrThrow({ where: { id: repositoryId }, include: { installation: true } });
	const where = { repositoryId_name: { repositoryId, name: repo.defaultBranch } };
	// ponytail: só a branch padrão; branches observadas (até 5, cascata) quando houver a UI de branches.
	await db.repoBranch.upsert({
		where,
		create: { repositoryId, name: repo.defaultBranch, priority: 0, status: 'syncing' },
		update: { status: 'syncing', error: null },
	});

	try {
		if ((repo.sizeKb ?? 0) > env.MAX_REPO_SIZE_MB * 1024) throw new Error(`repo maior que ${env.MAX_REPO_SIZE_MB} MB`);
		const dir = repoDir(repositoryId);
		const token = await installationToken(Number(repo.installation.githubInstallationId));
		const url = `https://github.com/${repo.fullName}.git`;

		if (existsSync(path.join(dir, '.git'))) {
			await git(['-C', dir, 'fetch', '--depth=1', url, repo.defaultBranch], token);
			await git(['-C', dir, 'reset', '--hard', 'FETCH_HEAD']);
		} else {
			await mkdir(path.dirname(dir), { recursive: true });
			await git(['clone', '--depth=1', '--single-branch', '--branch', repo.defaultBranch, url, dir], token);
		}

		const sha = await git(['-C', dir, 'rev-parse', 'HEAD']);
		await db.repoBranch.update({ where, data: { status: 'ready', lastSyncedSha: sha } });
	} catch (e) {
		await db.repoBranch.update({ where, data: { status: 'error', error: (e as Error).message.slice(0, 500) } });
		console.error(`[sync] ${repo.fullName}:`, e);
	}
}

// ponytail: re-sync por idade a cada chat; webhook push + cron de reconciliação substituem isso.
const STALE_MS = 10 * 60_000;

/** Kick a background sync for repos never synced, failed, or older than STALE_MS. Doesn't wait. */
export async function refreshStale(repositoryIds: string[]) {
	const branches = await db.repoBranch.findMany({ where: { repositoryId: { in: repositoryIds }, priority: 0 } });
	for (const id of repositoryIds) {
		const b = branches.find((b) => b.repositoryId === id);
		const old = b?.status === 'ready' && Date.now() - b.updatedAt.getTime() > STALE_MS;
		if (!b || b.status === 'pending' || b.status === 'error' || old) void syncRepo(id);
	}
}

/** Syncs interrupted by a restart would stay 'syncing' forever. */
export const resetStuckSyncs = () => db.repoBranch.updateMany({ where: { status: 'syncing' }, data: { status: 'pending' } });
