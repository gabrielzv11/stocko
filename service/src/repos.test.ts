import { afterAll, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

// GET /repos/{owner}/{repo} as the App: answers with `githubStatus`.
let githubStatus = 200;
mock.module('./client', () => ({
	installationOctokit: () => ({
		rest: {
			repos: { get: async () => (githubStatus === 200 ? { data: {} } : Promise.reject(Object.assign(new Error('gh'), { status: githubStatus }))) },
			apps: { listReposAccessibleToInstallation: async () => ({ data: { total_count: 0 } }) },
		},
	}),
	// Fails fast like the real client with the fake key: mock.module is process-wide, so a sync started by another
	// test file must not reach for github.com with a token.
	installationToken: async () => {
		throw new Error('no installation token in tests');
	},
}));

const base = await mkdtemp(path.join(tmpdir(), 'stocko-repos-'));
afterAll(() => rm(base, { recursive: true, force: true }));
// env may already be parsed by another test file in this process.
const { env } = await import('./env');
env.REPOS_DIR = base;

const { db } = await import('./db');
const { REVOKED, checkAccess, git, pruneUnobserved, repoDir } = await import('./repos');

test('checkAccess: only a 404 from GitHub revokes; the clone goes and the branch stops being readable', async () => {
	const workspace = await db.workspace.create({ data: { name: 'test' } });
	try {
		const installation = await db.installation.create({ data: { workspaceId: workspace.id, githubInstallationId: 1n, accountLogin: 'acme' } });
		const repo = await db.repository.create({
			data: {
				workspaceId: workspace.id,
				installationId: installation.id,
				githubRepoId: 1n,
				fullName: 'acme/app',
				defaultBranch: 'main',
				branches: { create: { name: 'main', priority: 0, status: 'ready', lastSyncedSha: 'abc' } },
			},
		});
		await mkdir(repoDir(repo.id), { recursive: true });

		// Outage / rate limit: access kept, clone untouched.
		githubStatus = 500;
		expect(await checkAccess(repo.id, { fresh: true })).toBe(true);
		// Cached for a while: a 404 now only lands on the next fresh check.
		githubStatus = 404;
		expect(await checkAccess(repo.id)).toBe(true);
		expect(existsSync(repoDir(repo.id))).toBe(true);

		expect(await checkAccess(repo.id, { fresh: true })).toBe(false);
		expect(existsSync(repoDir(repo.id))).toBe(false);
		expect(await db.repoBranch.findFirstOrThrow({ where: { repositoryId: repo.id } })).toMatchObject({ status: 'error', error: REVOKED, lastSyncedSha: null });
	} finally {
		githubStatus = 200;
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});

test('pruneUnobserved: commits that left the observed branches are gone from disk', async () => {
	const work = path.join(base, 'work');
	const bare = path.join(base, 'bare');
	const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
	const commit = async (file: string, text: string) => {
		await writeFile(path.join(work, file), text);
		await git(work, ['add', '.']);
		await git(work, [...id, 'commit', '--quiet', '-m', file]);
		return (await git(work, ['rev-parse', 'HEAD'])).trim();
	};
	await mkdir(work, { recursive: true });
	await mkdir(bare);
	await git(work, ['init', '--quiet']);
	await git(bare, ['init', '--bare', '--quiet']);

	const leaked = await commit('secret.txt', 'token=123');
	await git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main', 'HEAD:refs/heads/old']);
	// Force-push without the secret; "old" is no longer observed.
	await git(work, ['checkout', '--quiet', '--orphan', 'clean']);
	await git(work, ['rm', '-r', '--quiet', '--cached', '.']);
	await rm(path.join(work, 'secret.txt'));
	const clean = await commit('README.md', '# app');
	await git(work, ['push', '--quiet', '--force', bare, 'HEAD:refs/heads/main']);

	const has = (sha: string) => git(bare, ['cat-file', '-e', sha]).then(() => true, () => false);
	expect(await has(leaked)).toBe(true);
	await pruneUnobserved(bare, ['main']);
	expect(await has(leaked)).toBe(false);
	expect(await has(clean)).toBe(true);
	expect((await git(bare, ['for-each-ref', '--format=%(refname)'])).trim()).toBe('refs/heads/main');
});
