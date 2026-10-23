import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { chat } from './chat';
import { db } from './db';
import { env } from './env';
import { projects } from './projects';
import { resetStuckSyncs } from './repos';
import { settings } from './settings';
import { usage } from './usage';
import { webhooks } from './webhooks';

await resetStuckSyncs();

const app = new Hono();

app.use(logger());
// Bearer token auth, no cookies → no credentials needed.
app.use(cors({ origin: env.FRONTEND_URL }));

const tooLarge = (c: Context) => c.json({ error: 'payload_too_large' }, 413);
const small = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
// Corpos grandes: spec OpenAPI (até 10 MB de texto, folga para os escapes do JSON) e webhook de push com muitos commits.
const large = bodyLimit({ maxSize: 16 * 1024 * 1024, onError: tooLarge });
app.use((c, next) => (c.req.method === 'POST' && /\/apis$|^\/webhooks\//.test(c.req.path) ? large : small)(c, next));

app.get('/health', async (c) => {
	await db.$queryRaw`SELECT 1`;
	return c.json({ ok: true });
});

app.route('/', auth);
app.route('/', projects);
app.route('/', chat);
app.route('/', usage);
app.route('/', settings);
app.route('/', webhooks);

export default { port: env.PORT, fetch: app.fetch };
