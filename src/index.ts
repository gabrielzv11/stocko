import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { db } from './db';
import { env } from './env';

const app = new Hono();

app.use(logger());
// Bearer token auth, no cookies → no credentials needed.
app.use(cors({ origin: env.FRONTEND_URL }));

app.get('/health', async (c) => {
	await db.$queryRaw`SELECT 1`;
	return c.json({ ok: true });
});

app.route('/', auth);

export default { port: env.PORT, fetch: app.fetch };
