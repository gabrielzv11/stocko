import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';
// env may already be parsed by another test file in this process.
const { env } = await import('./env');
env.GITHUB_WEBHOOK_SECRET = 'whsec-test';

const { db } = await import('./db');
const { waitForSync } = await import('./repos');
const { webhooks } = await import('./webhooks');

const send = (event: string, payload: object, secret = 'whsec-test') => {
	const body = JSON.stringify(payload);
	const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
	return webhooks.request('/webhooks/github', { method: 'POST', body, headers: { 'X-GitHub-Event': event, 'X-Hub-Signature-256': signature } });
};

test('webhook: HMAC checked; push syncs only observed branches; removed repos are deleted', async () => {
	const githubInstallationId = BigInt(Date.now());
	const githubRepoId = githubInstallationId + 1n;
	const workspace = await db.workspace.create({ data: { name: 'test' } });
	const installation = await db.installation.create({ data: { workspaceId: workspace.id, githubInstallationId, accountLogin: 'acme' } });
	const repo = await db.repository.create({
		data: {
			workspaceId: workspace.id,
			installationId: installation.id,
			githubRepoId,
			fullName: 'acme/app',
			defaultBranch: 'main',
			branches: { create: { name: 'main', priority: 0, status: 'ready', lastSyncedSha: 'a'.repeat(40) } },
		},
	});
	const status = async () => (await db.repoBranch.findFirstOrThrow({ where: { repositoryId: repo.id } })).status;
	const push = (branch: string) => ({ ref: `refs/heads/${branch}`, repository: { id: Number(githubRepoId) } });

	try {
		expect((await send('push', push('main'), 'wrong')).status).toBe(401);
		expect(await status()).toBe('ready');

		expect((await send('push', push('feature-x'), 'whsec-test')).status).toBe(204);
		await waitForSync(repo.id);
		expect(await status()).toBe('ready');

		// Observed branch → sync runs (and fails here: no real installation behind it).
		expect((await send('push', push('main'))).status).toBe(204);
		await waitForSync(repo.id);
		expect(await status()).toBe('error');

		const removed = { action: 'removed', installation: { id: Number(githubInstallationId) }, repositories_removed: [{ id: Number(githubRepoId) }] };
		expect((await send('installation_repositories', removed)).status).toBe(204);
		expect(await db.repository.findUnique({ where: { id: repo.id } })).toBeNull();
	} finally {
		await db.workspace.delete({ where: { id: workspace.id } });
	}
});
