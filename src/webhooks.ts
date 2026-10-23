import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { env } from './env';
import { removeRepo, syncRepo } from './repos';

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(secret, raw body), compared in constant time. */
export function validSignature(secret: string, body: string, header: string | undefined) {
	if (!header) return false;
	const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
	const got = Buffer.from(header);
	return got.length === expected.length && timingSafeEqual(got, expected);
}

type Payload = {
	action?: string;
	ref?: string;
	repository?: { id: number };
	installation?: { id: number };
	repositories_removed?: { id: number }[];
};

export const webhooks = new Hono();

// GitHub App → Webhook: Push and Installation repositories events. Same repo can be in N workspaces.
webhooks.post('/webhooks/github', async (c) => {
	if (!env.GITHUB_WEBHOOK_SECRET) return c.json({ error: 'not_configured' }, 404);
	// Raw body: the HMAC is over the exact bytes GitHub sent.
	const raw = await c.req.text();
	if (!validSignature(env.GITHUB_WEBHOOK_SECRET, raw, c.req.header('X-Hub-Signature-256'))) return c.json({ error: 'invalid_signature' }, 401);
	const event = c.req.header('X-GitHub-Event');
	const payload = JSON.parse(raw) as Payload;

	if (event === 'push' && payload.ref?.startsWith('refs/heads/') && payload.repository) {
		// Only observed branches; the sync itself runs in the background (GitHub times out at 10s).
		const repos = await db.repository.findMany({
			where: { githubRepoId: BigInt(payload.repository.id), branches: { some: { name: payload.ref.slice('refs/heads/'.length) } } },
			select: { id: true },
		});
		for (const r of repos) void syncRepo(r.id);
	}

	if (event === 'installation_repositories' && payload.action === 'removed' && payload.installation) {
		const repos = await db.repository.findMany({
			where: {
				githubRepoId: { in: (payload.repositories_removed ?? []).map((r) => BigInt(r.id)) },
				installation: { githubInstallationId: BigInt(payload.installation.id) },
			},
			select: { id: true },
		});
		await Promise.all(repos.map((r) => removeRepo(r.id)));
	}

	if (event === 'installation' && payload.action === 'deleted' && payload.installation) {
		const where = { githubInstallationId: BigInt(payload.installation.id) };
		const repos = await db.repository.findMany({ where: { installation: where }, select: { id: true } });
		await Promise.all(repos.map((r) => removeRepo(r.id)));
		await db.installation.deleteMany({ where });
	}

	return c.body(null, 204);
});
