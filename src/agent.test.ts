import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';

const { agentTools, safePath } = await import('./agent');

test('safePath: allows files inside the repo, rejects ../, absolute paths and symlinks out', async () => {
	const base = await mkdtemp(path.join(tmpdir(), 'stocko-'));
	const root = path.join(base, 'repo');
	try {
		await mkdir(path.join(root, 'src'), { recursive: true });
		await writeFile(path.join(root, 'src', 'a.ts'), 'ok');
		await writeFile(path.join(base, 'secret'), 'nope');

		expect(await safePath(root, 'src/a.ts')).toEndWith(path.join('src', 'a.ts'));
		await expect(safePath(root, '../secret')).rejects.toThrow('fora do repositório');
		await expect(safePath(root, path.join(base, 'secret'))).rejects.toThrow('fora do repositório');

		// Windows without developer mode can't create symlinks; the realpath check still covers it on Linux (prod).
		const linked = await symlink(path.join(base, 'secret'), path.join(root, 'link')).then(
			() => true,
			() => false
		);
		if (linked) await expect(safePath(root, 'link')).rejects.toThrow('fora do repositório');
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test('tools: refuse repos outside the allowed list and patterns that climb out', async () => {
	const tools = agentTools([{ id: 'r1', fullName: 'acme/app' }]);
	const opts = { toolCallId: 't', messages: [] } as never;

	expect(await tools.read_file.execute!({ repo: 'other/repo', path: 'README.md' }, opts)).toContain('repo desconhecido');
	expect(await tools.grep.execute!({ repo: 'other/repo', regex: 'x' }, opts)).toContain('repo desconhecido');
	expect(await tools.glob.execute!({ repo: 'acme/app', pattern: '../**' }, opts)).toContain('relativo ao repo');
});
