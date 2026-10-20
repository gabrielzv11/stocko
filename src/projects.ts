import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, type AuthVars } from './auth';
import { installationOctokit } from './client';
import { db } from './db';
import { syncRepo } from './repos';

/** Repos the App can reach across the workspace's installations, most recently pushed first. */
async function accessibleRepos(workspaceId: string) {
	const installations = await db.installation.findMany({ where: { workspaceId } });
	const lists = await Promise.all(
		installations.map(async (i) => {
			const octokit = installationOctokit(Number(i.githubInstallationId));
			// Installation removed on GitHub (404) doesn't take the whole list down; anything else is a real error.
			const repos = await octokit
				.paginate(octokit.rest.apps.listReposAccessibleToInstallation, { per_page: 100 })
				.catch((e) => {
					if (e.status === 404) return [];
					throw e;
				});
			return repos.map((r) => ({
				installationId: i.id,
				id: String(r.id),
				name: r.name,
				fullName: r.full_name,
				url: r.html_url,
				private: r.private,
				defaultBranch: r.default_branch,
				sizeKb: r.size,
				pushedAt: r.pushed_at ?? null,
			}));
		})
	);
	return lists.flat().sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}

export const projects = new Hono<{ Variables: AuthVars }>();

projects.get('/github/repos', requireAuth, async (c) => {
	const repos = await accessibleRepos(c.var.workspaceId);
	return c.json(repos.map(({ installationId, defaultBranch, sizeKb, ...r }) => r));
});

projects.get('/projects', requireAuth, async (c) => {
	const list = await db.project.findMany({
		where: { workspaceId: c.var.workspaceId },
		orderBy: { createdAt: 'desc' },
		include: { sources: { include: { repository: true } } },
	});
	return c.json(
		list.map((p) => ({
			id: p.id,
			name: p.name,
			repos: p.sources.flatMap((s) =>
				s.repository ? [{ id: String(s.repository.githubRepoId), fullName: s.repository.fullName }] : []
			),
		}))
	);
});

const createProject = z.object({
	name: z.string().trim().min(1).max(100),
	repoIds: z.array(z.string()).min(1),
});

projects.post('/projects', requireAuth, async (c) => {
	const body = createProject.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body' }, 400);
	const { workspaceId } = c.var;

	// Only repos this workspace's installations can reach (anti-IDOR).
	const repos = (await accessibleRepos(workspaceId)).filter((r) => body.data.repoIds.includes(r.id));
	if (repos.length !== new Set(body.data.repoIds).size) return c.json({ error: 'unknown_repo' }, 400);

	// One Repository row per workspace, shared by every project that uses it.
	const rows = await Promise.all(
		repos.map((r) => {
			const data = { installationId: r.installationId, fullName: r.fullName, defaultBranch: r.defaultBranch, sizeKb: r.sizeKb };
			return db.repository.upsert({
				where: { workspaceId_githubRepoId: { workspaceId, githubRepoId: BigInt(r.id) } },
				create: { ...data, workspaceId, githubRepoId: BigInt(r.id) },
				update: data,
			});
		})
	);
	const project = await db.project.create({
		data: {
			workspaceId,
			name: body.data.name,
			sources: { create: rows.map((r) => ({ type: 'github_repo' as const, repositoryId: r.id })) },
		},
	});
	// Clone in the background so the first question finds the code ready.
	for (const r of rows) void syncRepo(r.id);
	return c.json({ id: project.id }, 201);
});

projects.delete('/projects/:id', requireAuth, async (c) => {
	const { count } = await db.project.deleteMany({ where: { id: c.req.param('id'), workspaceId: c.var.workspaceId } });
	return count ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});
