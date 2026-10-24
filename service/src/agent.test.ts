import { afterAll, expect, test } from 'bun:test';
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

const base = await mkdtemp(path.join(tmpdir(), 'stocko-'));
process.env.REPOS_DIR = base;
afterAll(() => rm(base, { recursive: true, force: true }));

let sha = '';
let devSha = '';
const { db } = await import('./db');
// Prisma's model methods are proxies that ignore spyOn; swap the whole delegate and put it back after.
const realBranches = db.repoBranch;
Object.assign(db, {
	repoBranch: {
		findMany: async () => [
			{ name: 'main', lastSyncedSha: sha },
			{ name: 'develop', lastSyncedSha: devSha },
		],
	},
});
afterAll(() => Object.assign(db, { repoBranch: realBranches }));

const { agentTools, globToRegex, zoektAtom } = await import('./agent');
const { git } = await import('./repos');

/** Bare repo at REPOS_DIR/r1, as the sync leaves it, with one commit pushed from a scratch checkout. */
async function makeRepo() {
	const work = path.join(base, 'work');
	await mkdir(path.join(work, 'src'), { recursive: true });
	await writeFile(path.join(work, 'src', 'a.ts'), 'export const a = 1;\nexport const b = "x y";\n');
	await writeFile(path.join(work, 'README.md'), '# app\n');
	await writeFile(path.join(base, 'secret'), 'nope');
	const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
	await git(work, ['init', '--quiet']);
	await git(work, ['add', '.']);
	await git(work, [...id, 'commit', '--quiet', '-m', 'init']);
	await mkdir(path.join(base, 'r1'));
	await git(path.join(base, 'r1'), ['init', '--bare', '--quiet']);
	await git(work, ['push', '--quiet', path.join(base, 'r1'), 'HEAD:refs/heads/main']);
	sha = (await git(work, ['rev-parse', 'HEAD'])).trim();
	// develop = main + a file that only exists there.
	await writeFile(path.join(work, 'src', 'next.ts'), 'export const next = 2;\n');
	await git(work, ['add', '.']);
	await git(work, [...id, 'commit', '--quiet', '-m', 'next']);
	await git(work, ['push', '--quiet', path.join(base, 'r1'), 'HEAD:refs/heads/develop']);
	devSha = (await git(work, ['rev-parse', 'HEAD'])).trim();
}

test('tools read the bare repo by SHA and never leave its tree', async () => {
	await makeRepo();
	const tools = agentTools([{ id: 'r1', fullName: 'acme/app' }]);
	const opts = { toolCallId: 't', messages: [] } as never;
	const call = (name: 'glob' | 'grep' | 'read_file', input: object) => (tools[name].execute as unknown as (i: object, o: never) => Promise<string>)(input, opts);

	expect(await call('glob', { repo: 'acme/app', pattern: '**/*.ts' })).toBe('src/a.ts');
	expect(await call('glob', { repo: 'acme/app', pattern: '**/*.ts', ref: 'develop' })).toBe('src/a.ts\nsrc/next.ts');
	expect(await call('glob', { repo: 'acme/app', pattern: '../**' })).toStartWith('nenhum arquivo em main');

	expect(await call('grep', { repo: 'acme/app', regex: 'const \\w+ = 1' })).toBe('src/a.ts:1:export const a = 1;');
	expect(await call('grep', { repo: 'acme/app', regex: 'app', glob: '*.ts' })).toStartWith('nenhum resultado em main');

	expect(await call('read_file', { repo: 'acme/app', path: './src/a.ts', start: 2 })).toBe(`acme/app/./src/a.ts@${sha.slice(0, 7)} · branch main\n2\texport const b = "x y";\n3\t`);
	// Cascade: not in main → hint with the next branches; there with ref, or by sha.
	expect(await call('read_file', { repo: 'acme/app', path: 'src/next.ts' })).toContain('outras branches, em ordem: develop (use ref)');
	expect(await call('read_file', { repo: 'acme/app', path: 'src/next.ts', ref: 'develop' })).toContain('export const next = 2;');
	expect(await call('read_file', { repo: 'acme/app', path: 'src/next.ts', ref: devSha.slice(0, 7) })).toContain('export const next = 2;');
	expect(await call('read_file', { repo: 'acme/app', path: 'README.md', ref: 'nope' })).toContain('ref desconhecida: nope. Branches sincronizadas, em ordem de prioridade: main, develop');
	expect(await call('read_file', { repo: 'acme/app', path: 'src' })).toContain('é um diretório');
	expect(await call('read_file', { repo: 'acme/app', path: '../secret' })).toContain('não encontrado');
	expect(await call('read_file', { repo: 'acme/app', path: path.join(base, 'secret') })).toContain('não encontrado');
	expect(await call('read_file', { repo: 'other/repo', path: 'README.md' })).toContain('repo desconhecido');
});

test('zoekt query helpers', () => {
	const re = (g: string) => new RegExp(globToRegex(g));
	expect(re('*.ts').test('src/x/a.ts')).toBe(true);
	expect(re('src/*.ts').test('src/x/a.ts')).toBe(false);
	expect(re('src/**/*.{ts,tsx}').test('src/a.tsx')).toBe(true);
	expect(re('src/**/*.{ts,tsx}').test('src/a.js')).toBe(false);
	expect(re('a.b').test('axb')).toBe(false);

	expect(zoektAtom('foo bar')).toBe('foo\\x20bar');
	expect(zoektAtom('say "hi"\\ \\d')).toBe('say\\x20\\x22hi\\x22\\x20\\d');
});
