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
	// OpenRouter (openrouter.ai/keys). Model is any OpenRouter slug; avoid `:free` with client code.
	OPENROUTER_API_KEY: z.string().min(1),
	LLM_MODEL: z.string().default('anthropic/claude-sonnet-5.5'),
	// Shallow clones the agent searches. Railway: volume mounted at /data/repos.
	REPOS_DIR: z.string().default('./data/repos'),
	MAX_REPO_SIZE_MB: z.coerce.number().default(500),
	// Comma-separated GitHub logins allowed to sign in.
	ALLOWED_GITHUB_LOGINS: z.string().transform((s) =>
		s
			.split(',')
			.map((l) => l.trim().toLowerCase())
			.filter(Boolean)
	),
});

export const env = schema.parse(process.env);
