import { afterAll, expect, mock, test } from 'bun:test';
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

// checkAccess asks GitHub whether the App still sees the repo: always yes here.
mock.module('./client', () => ({
	installationOctokit: () => ({ rest: { repos: { get: async () => ({ data: {} }) } } }),
	installationToken: async () => {
		throw new Error('no installation token in tests');
	},
}));

const base = await mkdtemp(path.join(tmpdir(), 'stocko-query-'));
afterAll(() => rm(base, { recursive: true, force: true }));
// env may already be parsed by another test file in this process.
const { env } = await import('./env');
env.REPOS_DIR = base;

const { db } = await import('./db');
const { git, repoDir } = await import('./repos');
const { MAX_READ_LINES, QueryError, citations, listProjects, readFile, searchCode } = await import('./query');

/** Workspace with one project whose repo (acme/app) is synced at a real bare repo; a second repo when `twoRepos`. */
async function workspaceWithRepo(name: string, { twoRepos = false } = {}) {
	const workspace = await db.workspace.create({ data: { name } });
	const installation = await db.installation.create({ data: { workspaceId: workspace.id, githubInstallationId: 1n, accountLogin: 'acme' } });
	const repo = (fullName: string, n: bigint) =>
		db.repository.create({ data: { workspaceId: workspace.id, installationId: installation.id, githubRepoId: n, fullName, defaultBranch: 'main' } });
	const app = await repo('acme/app', 1n);
	const lib = twoRepos && (await repo('acme/lib', 2n));
	// Failed sync, not pending: a pending one would start a background sync that outlives the test.
	if (lib) await db.repoBranch.create({ data: { repositoryId: lib.id, name: 'main', priority: 0, status: 'error', error: 'repo maior que 500 MB' } });
	const repos = lib ? [app, lib] : [app];
	const project = await db.project.create({
		data: { workspaceId: workspace.id, name, sources: { create: repos.map((r) => ({ type: 'github_repo' as const, repositoryId: r.id })) } },
	});

	const work = path.join(base, `work-${app.id}`);
	await mkdir(path.join(work, 'src'), { recursive: true });
	await writeFile(path.join(work, 'src', 'a.ts'), 'export const a = 1;\n');
	await writeFile(path.join(work, 'big.txt'), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
	const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
	await git(work, ['init', '--quiet']);
	await git(work, ['add', '.']);
	await git(work, [...id, 'commit', '--quiet', '-m', 'init']);
	const sha = (await git(work, ['rev-parse', 'HEAD'])).trim();
	await mkdir(repoDir(app.id), { recursive: true });
	await git(repoDir(app.id), ['init', '--bare', '--quiet']);
	await git(work, ['push', '--quiet', repoDir(app.id), 'HEAD:refs/heads/main']);
	const syncedAt = new Date('2026-10-01T12:00:00Z');
	await db.repoBranch.create({ data: { repositoryId: app.id, name: 'main', priority: 0, status: 'ready', lastSyncedSha: sha, lastSyncedAt: syncedAt } });
	return { workspace, project, sha, syncedAt };
}

const code = (p: Promise<unknown>) =>
	p.then(
		() => 'ok',
		(e: unknown) => (e instanceof QueryError ? e.code : e)
	);

test('a project of another workspace looks nonexistent to every query', async () => {
	const mine = await workspaceWithRepo('mine');
	const theirs = await workspaceWithRepo('theirs');
	try {
		const scope = { workspaceId: mine.workspace.id };
		expect(await code(readFile(scope, { project: mine.project.id, path: 'src/a.ts' }))).toBe('ok');
		expect(await code(readFile(scope, { project: theirs.project.id, path: 'src/a.ts' }))).toBe('PROJECT_NOT_FOUND');
		expect(await code(searchCode(scope, { project: theirs.project.id, query: 'a' }))).toBe('PROJECT_NOT_FOUND');
		expect(await code(readFile(scope, { project: 'nope', path: 'src/a.ts' }))).toBe('PROJECT_NOT_FOUND');
		expect((await listProjects(scope)).projects.map((p) => p.id)).toEqual([mine.project.id]);
	} finally {
		await db.workspace.deleteMany({ where: { id: { in: [mine.workspace.id, theirs.workspace.id] } } });
	}
});

test('read_file: only blobs of the indexed tree, never the host filesystem', async () => {
	const { workspace, project, sha, syncedAt } = await workspaceWithRepo('traversal');
	await writeFile(path.join(base, 'secret'), 'nope');
	try {
		const read = (p: string) => readFile({ workspaceId: workspace.id }, { project: project.id, path: p });
		expect(await read('./src/a.ts')).toMatchObject({ indexedSha: sha, indexedAt: syncedAt.toISOString(), content: 'export const a = 1;', totalLines: 1 });
		for (const p of ['../secret', '../../secret', 'src/../../secret', path.join(base, 'secret'), '/etc/passwd', 'src/*', 'src'])
			expect(await code(read(p))).toBe('FILE_NOT_FOUND');
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});

test('read_file: at most MAX_READ_LINES per call, truncated only when less than asked came back', async () => {
	const { workspace, project } = await workspaceWithRepo('truncation');
	try {
		const read = (startLine?: number, endLine?: number) => readFile({ workspaceId: workspace.id }, { project: project.id, path: 'big.txt', startLine, endLine });
		const all = await read();
		expect(all).toMatchObject({ startLine: 1, endLine: MAX_READ_LINES, totalLines: 1000, truncated: true });
		expect(all.content.split('\n')).toHaveLength(MAX_READ_LINES);
		expect(await read(10, 12)).toMatchObject({ content: 'line 10\nline 11\nline 12', truncated: false });
		expect(await read(990, 2000)).toMatchObject({ startLine: 990, endLine: 1000, truncated: false });
		expect(await read(901)).toMatchObject({ endLine: 1000, truncated: false });
		expect(await code(read(1001))).toBe('INVALID_INPUT');
		expect(await code(read(5, 4))).toBe('INVALID_INPUT');
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});

test('repo is required when the project has more than one; search without a Zoekt index is unavailable', async () => {
	const { workspace, project } = await workspaceWithRepo('two', { twoRepos: true });
	try {
		const scope = { workspaceId: workspace.id };
		expect(await code(readFile(scope, { project: project.id, path: 'src/a.ts' }))).toBe('INVALID_INPUT');
		expect(await code(readFile(scope, { project: project.id, repo: 'acme/other', path: 'src/a.ts' }))).toBe('INVALID_INPUT');
		expect(await code(readFile(scope, { project: project.id, repo: 'ACME/App', path: 'src/a.ts' }))).toBe('ok');
		// acme/lib has no synced branch.
		expect(await code(readFile(scope, { project: project.id, repo: 'acme/lib', path: 'src/a.ts' }))).toBe('INDEX_UNAVAILABLE');
		expect(await code(searchCode(scope, { project: project.id, repo: 'acme/app', query: 'a' }))).toBe('INDEX_UNAVAILABLE');
		const [listed] = (await listProjects(scope)).projects;
		expect(listed?.repos.map((r) => r.indexedSha === null)).toEqual([false, true]);
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});

test('citations: only the asked repo, line ranges, deduplicated', () => {
	const text = 'Total em `acme/app/src/cart.ts#L10-L24@3f9c2ab` e `acme/app/src/cart.ts#L10-L24@3f9c2ab`; ver `acme/app/x.go#L7@3f9c2ab` e `acme/other/y.ts#L1@3f9c2ab`.';
	expect(citations(text, 'acme/app')).toEqual([
		{ path: 'src/cart.ts', startLine: 10, endLine: 24 },
		{ path: 'x.go', startLine: 7, endLine: 7 },
	]);
});
