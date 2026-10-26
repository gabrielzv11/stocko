import { z } from 'zod';

const schema = z.object({
	PORT: z.coerce.number().default(8000),
	DATABASE_URL: z.url(),
	FRONTEND_URL: z.url().default('http://localhost:5003'),
	// GitHub App OAuth (Settings → Developer settings → GitHub Apps → Client ID / secret).
	GITHUB_CLIENT_ID: z.string().min(1),
	GITHUB_CLIENT_SECRET: z.string().min(1),
	// GitHub App → App ID, public link slug (github.com/apps/<slug>) and private key (.pem; \n escaped is fine).
	GITHUB_APP_ID: z.string().min(1),
	GITHUB_APP_SLUG: z.string().min(1),
	GITHUB_APP_PRIVATE_KEY: z
		.string()
		.min(1)
		.transform((s) => s.replace(/\\n/g, '\n'))
		// Fingerprint (SHA256:...) in place of the .pem only fails on the first GitHub call; fail at boot instead.
		.refine((s) => s.includes('PRIVATE KEY-----'), 'expected .pem content, not the key fingerprint'),
	// GitHub App → Webhook secret. Unset = /webhooks/github off (repos only update on manual sync).
	GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
	// OpenRouter (openrouter.ai/keys). Model is any OpenRouter slug; avoid `:free` with client code.
	OPENROUTER_API_KEY: z.string().min(1),
	LLM_MODEL: z.string().default('anthropic/claude-sonnet-5.5'),
	// Teto de gasto (USD) por workspace nas últimas 24h; só conta o custo reportado pelo OpenRouter (chave do servidor).
	MAX_DAILY_COST_USD: z.coerce.number().positive().default(5),
	// Workspaces que uma conta pode criar (ser dona): o gasto máximo de uma conta é isto × MAX_DAILY_COST_USD.
	MAX_WORKSPACES_PER_USER: z.coerce.number().int().positive().default(3),
	// Contexto (tokens de entrada do último passo do turno) acima disto → turnos antigos viram resumo. ~60% da janela do modelo.
	CONTEXT_SUMMARY_TOKENS: z.coerce.number().positive().default(100_000),
	// Mangaba Router (OpenAI-compatible). Key is per workspace (Settings), so only the base URL lives here.
	MANGABA_BASE_URL: z
		.url()
		.default('https://mangabarouter.store/v1')
		.transform((s) => s.replace(/\/+$/, '')),
	// Shallow clones the agent searches. Railway: volume mounted at /data/repos.
	REPOS_DIR: z.string().default('./data/repos'),
	MAX_REPO_SIZE_MB: z.coerce.number().default(500),
	// Agent's grep: 'git' (git grep -P on the bare repo) or 'zoekt' (trigram index; binaries only in the Docker image).
	GREP_BACKEND: z.enum(['git', 'zoekt']).default('git'),
	// 32 random bytes in base64 (`openssl rand -base64 32`). Encrypts API auth headers; only needed to save one.
	SECRETS_KEY: z
		.string()
		.refine((s) => Buffer.from(s, 'base64').length === 32, 'expected 32 bytes in base64')
		.optional(),
	// Comma-separated GitHub logins that may create workspaces; empty = anyone. Everyone can sign in and join by invite.
	ALLOWED_GITHUB_LOGINS: z
		.string()
		.default('')
		.transform((s) =>
		s
			.split(',')
			.map((l) => l.trim().toLowerCase())
			.filter(Boolean)
	),
});

export const env = schema.parse(process.env);
