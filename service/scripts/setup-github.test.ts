import { expect, test } from 'bun:test';
import { upsertEnv } from './setup-github';

test('upsertEnv: replaces plain and quoted multi-line values, appends missing keys', () => {
	const env = 'PORT=8000\nGITHUB_APP_ID=\nGITHUB_APP_PRIVATE_KEY="-----BEGIN\nabc\n-----END"\nLLM_MODEL=x\n';
	let out = upsertEnv(env, 'GITHUB_APP_ID', '42');
	out = upsertEnv(out, 'GITHUB_APP_PRIVATE_KEY', '"k\\nk"');
	out = upsertEnv(out, 'GITHUB_WEBHOOK_SECRET', 's$1');
	expect(out).toBe('PORT=8000\nGITHUB_APP_ID=42\nGITHUB_APP_PRIVATE_KEY="k\\nk"\nLLM_MODEL=x\nGITHUB_WEBHOOK_SECRET=s$1\n');
});
