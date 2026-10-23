import { Hono } from 'hono';
import { z } from 'zod';
import { assertPublicUrl, parseSpec, seal } from './apis';
import { requireAuth, type AuthVars } from './auth';
import { installationOctokit } from './client';
import { db } from './db';
import type { Prisma } from './generated/prisma/client';
import { MAX_BRANCHES, syncRepo } from './repos';

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
		include: { sources: { include: { repository: { include: { branches: { orderBy: { priority: 'asc' } } } } } } },
	});
	return c.json(
		list.map((p) => ({
			id: p.id,
			name: p.name,
			repos: p.sources.flatMap(({ repository: r }) =>
				r
					? [
							{
								id: String(r.githubRepoId),
								repositoryId: r.id,
								fullName: r.fullName,
								branches: r.branches.map(({ id, name, status, lastSyncedSha, error }) => ({ id, name, status, lastSyncedSha, error })),
							},
						]
					: []
			),
		}))
	);
});

// ---------- branches (cascade: lower priority value = higher precedence) ----------

/** The workspace's repository (anti-IDOR) with its installation's Octokit. */
async function repository(workspaceId: string, id: string) {
	const repo = await db.repository.findFirst({ where: { id, workspaceId }, include: { installation: true, branches: { orderBy: { priority: 'asc' } } } });
	if (!repo) return null;
	const [owner = '', name = ''] = repo.fullName.split('/');
	return { repo, owner, name, octokit: installationOctokit(Number(repo.installation.githubInstallationId)) };
}

projects.get('/repositories/:id/remote-branches', requireAuth, async (c) => {
	const r = await repository(c.var.workspaceId, c.req.param('id'));
	if (!r) return c.json({ error: 'not_found' }, 404);
	const names: string[] = [];
	// ponytail: até 1000 branches; busca no GitHub se algum repo tiver mais.
	for await (const { data } of r.octokit.paginate.iterator(r.octokit.rest.repos.listBranches, { owner: r.owner, repo: r.name, per_page: 100 })) {
		names.push(...data.map((b) => b.name));
		if (names.length >= 1000) break;
	}
	return c.json(names);
});

projects.post('/repositories/:id/branches', requireAuth, async (c) => {
	const body = z.object({ name: z.string().trim().min(1).max(255) }).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body' }, 400);
	const r = await repository(c.var.workspaceId, c.req.param('id'));
	if (!r) return c.json({ error: 'not_found' }, 404);
	if (r.repo.branches.length >= MAX_BRANCHES) return c.json({ error: 'invalid_branch', message: `Máximo de ${MAX_BRANCHES} branches por repositório.` }, 400);
	if (r.repo.branches.some((b) => b.name === body.data.name)) return c.json({ error: 'invalid_branch', message: 'Branch já observada.' }, 400);
	// Must exist on GitHub: also guarantees a valid ref name for the fetch refspec.
	const exists = await r.octokit.rest.repos.getBranch({ owner: r.owner, repo: r.name, branch: body.data.name }).catch((e) => {
		if (e.status === 404) return null;
		throw e;
	});
	if (!exists) return c.json({ error: 'invalid_branch', message: 'Branch não existe no GitHub.' }, 400);

	const priority = (r.repo.branches.at(-1)?.priority ?? -1) + 1;
	const branch = await db.repoBranch.create({ data: { repositoryId: r.repo.id, name: body.data.name, priority } });
	void syncRepo(r.repo.id);
	return c.json({ id: branch.id }, 201);
});

projects.delete('/repositories/:id/branches/:bid', requireAuth, async (c) => {
	const r = await repository(c.var.workspaceId, c.req.param('id'));
	const branch = r?.repo.branches.find((b) => b.id === c.req.param('bid'));
	if (!r || !branch) return c.json({ error: 'not_found' }, 404);
	if (r.repo.branches.length === 1) return c.json({ error: 'invalid_branch', message: 'O repositório precisa de ao menos uma branch.' }, 400);
	await db.repoBranch.delete({ where: { id: branch.id } });
	// New top branch → HEAD and Zoekt index move to it.
	if (branch === r.repo.branches[0]) void syncRepo(r.repo.id);
	return c.body(null, 204);
});

projects.put('/repositories/:id/branches/order', requireAuth, async (c) => {
	const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body' }, 400);
	const r = await repository(c.var.workspaceId, c.req.param('id'));
	if (!r) return c.json({ error: 'not_found' }, 404);
	const { ids } = body.data;
	const same = ids.length === r.repo.branches.length && new Set(ids).size === ids.length && r.repo.branches.every((b) => ids.includes(b.id));
	if (!same) return c.json({ error: 'invalid_order', message: 'Envie todas as branches do repositório, uma vez cada.' }, 400);
	await db.$transaction(ids.map((id, priority) => db.repoBranch.update({ where: { id }, data: { priority } })));
	if (ids[0] !== r.repo.branches[0]?.id) void syncRepo(r.repo.id);
	return c.body(null, 204);
});

projects.post('/repositories/:id/sync', requireAuth, async (c) => {
	const r = await repository(c.var.workspaceId, c.req.param('id'));
	if (!r) return c.json({ error: 'not_found' }, 404);
	void syncRepo(r.repo.id);
	return c.body(null, 202);
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

const apiSummary = { id: true, title: true, description: true, usage: true, baseUrl: true, createdAt: true } as const;

projects.get('/projects/:id/apis', requireAuth, async (c) => {
	const list = await db.apiSpec.findMany({
		where: { projectId: c.req.param('id'), project: { workspaceId: c.var.workspaceId } },
		orderBy: { createdAt: 'asc' },
		select: { ...apiSummary, authHeader: true },
	});
	// Never send the secret back, only whether there is one.
	return c.json(list.map(({ authHeader, ...a }) => ({ ...a, hasAuth: !!authHeader })));
});

const createApi = z.object({
	title: z.string().trim().min(1).max(100),
	description: z.string().trim().min(1).max(2000),
	usage: z.string().trim().max(4000).default(''),
	baseUrl: z.url().optional(),
	authHeader: z
		.string()
		.trim()
		.regex(/^[\w-]+:\s*\S.*$/, 'formato "Header: valor"')
		.optional(),
	spec: z.string().min(1).max(10 * 1024 * 1024),
});

projects.post('/projects/:id/apis', requireAuth, async (c) => {
	const body = createApi.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
	const project = await db.project.findFirst({ where: { id: c.req.param('id'), workspaceId: c.var.workspaceId } });
	if (!project) return c.json({ error: 'not_found' }, 404);

	const { spec, authHeader, baseUrl, ...meta } = body.data;
	try {
		const data = {
			...meta,
			projectId: project.id,
			spec: parseSpec(spec) as Prisma.InputJsonValue,
			baseUrl: baseUrl ? (await assertPublicUrl(baseUrl)).href : null,
			authHeader: authHeader ? seal(authHeader) : null,
		};
		const api = await db.apiSpec.create({ data, select: apiSummary });
		return c.json(api, 201);
	} catch (e) {
		return c.json({ error: 'invalid_api', message: (e as Error).message }, 400);
	}
});

projects.delete('/projects/:id/apis/:aid', requireAuth, async (c) => {
	const { count } = await db.apiSpec.deleteMany({
		where: { id: c.req.param('aid'), projectId: c.req.param('id'), project: { workspaceId: c.var.workspaceId } },
	});
	return count ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});

projects.delete('/projects/:id', requireAuth, async (c) => {
	const { count } = await db.project.deleteMany({ where: { id: c.req.param('id'), workspaceId: c.var.workspaceId } });
	return count ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
});
