import { z } from 'zod';

const schema = z.object({
	PORT: z.coerce.number().default(8000),
	DATABASE_URL: z.url(),
	FRONTEND_URL: z.url().default('http://localhost:5003'),
	// GitHub App OAuth (Settings → Developer settings → GitHub Apps → Client ID / secret).
	GITHUB_CLIENT_ID: z.string().min(1),
	GITHUB_CLIENT_SECRET: z.string().min(1),
	// Comma-separated GitHub logins allowed to sign in.
	ALLOWED_GITHUB_LOGINS: z.string().transform((s) =>
		s
			.split(',')
			.map((l) => l.trim().toLowerCase())
			.filter(Boolean)
	),
});

export const env = schema.parse(process.env);
