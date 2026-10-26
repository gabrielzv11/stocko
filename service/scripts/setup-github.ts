// Creates this instance's GitHub App from a manifest (one click on GitHub) and writes its credentials to .env.
// Usage: bun run setup:github --api https://api.example.com [--org my-org] [--name "Stocko (Acme)"]
// https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
import { parseArgs } from 'node:util';

/** Sets KEY=value in a .env text: replaces the line (or a "quoted, multi-line" value) or appends it. */
export function upsertEnv(text: string, key: string, value: string) {
	const line = `${key}=${value}`;
	const re = new RegExp(`^${key}=(?:"[^"]*"|.*)$`, 'm');
	return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: { api: { type: 'string' }, org: { type: 'string' }, name: { type: 'string', default: 'Stocko' }, port: { type: 'string', default: '3999' } },
	});
	if (!values.api) throw new Error('missing --api <public API URL>, e.g. --api http://localhost:8000');
	const api = values.api.replace(/\/+$/, '');
	const port = Number(values.port);
	// GitHub rejects webhook URLs it can't reach; locally repos update through the manual sync.
	const publicApi = !['localhost', '127.0.0.1'].includes(new URL(api).hostname);
	const state = crypto.randomUUID();

	const manifest = {
		name: values.name,
		url: api,
		redirect_url: `http://localhost:${port}/callback`,
		callback_urls: [`${api}/auth/github/callback`],
		setup_url: `${api}/auth/github/login`,
		setup_on_update: true,
		// Public: GitHub answers 404 when another account tries to sign in with a private App.
		// Access is still per workspace (invites); installations only link to workspaces whose owner can see them.
		public: true,
		default_permissions: { contents: 'read', metadata: 'read' },
		...(publicApi && { hook_attributes: { url: `${api}/webhooks/github` }, default_events: ['push'] }),
	};
	const action = values.org
		? `https://github.com/organizations/${encodeURIComponent(values.org)}/settings/apps/new?state=${state}`
		: `https://github.com/settings/apps/new?state=${state}`;
	const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

	const server = Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === '/') {
				return new Response(
					`<form method="post" action="${escape(action)}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"></form><script>document.forms[0].submit()</script>`,
					{ headers: { 'Content-Type': 'text/html' } }
				);
			}
			if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) return new Response('not found', { status: 404 });

			const res = await fetch(`https://api.github.com/app-manifests/${url.searchParams.get('code')}/conversions`, {
				method: 'POST',
				headers: { Accept: 'application/vnd.github+json' },
			});
			if (!res.ok) return new Response(`GitHub: ${res.status} ${await res.text()}`, { status: 502 });
			const app = (await res.json()) as { id: number; slug: string; client_id: string; client_secret: string; webhook_secret: string | null; pem: string };

			const file = Bun.file('.env');
			let env = (await file.exists()) ? await file.text() : await Bun.file('.env.example').text();
			const vars: Record<string, string> = {
				GITHUB_APP_ID: String(app.id),
				GITHUB_APP_SLUG: app.slug,
				GITHUB_CLIENT_ID: app.client_id,
				GITHUB_CLIENT_SECRET: app.client_secret,
				GITHUB_APP_PRIVATE_KEY: `"${app.pem.trim().replace(/\n/g, '\\n')}"`,
				...(app.webhook_secret && { GITHUB_WEBHOOK_SECRET: app.webhook_secret }),
			};
			for (const [k, v] of Object.entries(vars)) env = upsertEnv(env, k, v);
			await Bun.write('.env', env);

			const install = `https://github.com/apps/${app.slug}/installations/new`;
			console.log(`GitHub App "${app.slug}" criado; credenciais gravadas em .env.\nInstale no GitHub depois de subir a API: ${install}`);
			setTimeout(() => server.stop(), 100);
			return new Response(`App criado e credenciais gravadas em .env. Pode fechar esta aba.`);
		},
	});
	console.log(`Abra http://localhost:${port} para criar o GitHub App${values.org ? ` na organização ${values.org}` : ''}.`);
}
