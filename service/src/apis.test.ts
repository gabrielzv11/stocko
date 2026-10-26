import { expect, test } from 'bun:test';

process.env.GITHUB_CLIENT_ID ||= 'test';
process.env.GITHUB_CLIENT_SECRET ||= 'test';
process.env.ALLOWED_GITHUB_LOGINS ??= '';
process.env.GITHUB_APP_ID ||= 'test';
process.env.GITHUB_APP_SLUG ||= 'test';
process.env.GITHUB_APP_PRIVATE_KEY ||= '-----BEGIN PRIVATE KEY-----test';
process.env.OPENROUTER_API_KEY ||= 'test';
// env may already be parsed by another test file in this process.
const { env } = await import('./env');
env.SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');

const { apiTools, assertPublicUrl, buildUrl, isPrivateIp, parseSpec, readCapped, seal, searchOperations, unseal } = await import('./apis');

test('isPrivateIp / assertPublicUrl: block internal targets', async () => {
	for (const ip of [
		'127.0.0.1',
		'10.1.2.3',
		'172.20.0.1',
		'192.168.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'224.0.0.1',
		'::',
		'::1',
		'0:0:0:0:0:0:0:1',
		'fd12::1',
		'fe80::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:a9fe:a9fe',
		'::7f00:1',
		'64:ff9b::a9fe:a9fe',
		'2002:7f00:1::1',
	])
		expect(isPrivateIp(ip)).toBe(true);
	for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateIp(ip)).toBe(false);
	await expect(assertPublicUrl('http://169.254.169.254/latest')).rejects.toThrow('rede privada');
	await expect(assertPublicUrl('http://[::1]:8000/')).rejects.toThrow('rede privada');
	// URL normalizes these to the hex form (::ffff:7f00:1, ::7f00:1).
	await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow('rede privada');
	await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/latest')).rejects.toThrow('rede privada');
	await expect(assertPublicUrl('http://[::127.0.0.1]/')).rejects.toThrow('rede privada');
	await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('http(s)');
});

test('buildUrl: stays under baseUrl origin and prefix', () => {
	expect(buildUrl('https://prom.acme.io/prom/', '/api/v1/query', { query: 'up' }).href).toBe('https://prom.acme.io/prom/api/v1/query?query=up');
	expect(() => buildUrl('https://prom.acme.io', '//evil.com/x')).toThrow();
	expect(() => buildUrl('https://prom.acme.io/prom', '/../admin')).toThrow();
	expect(() => buildUrl('https://prom.acme.io', 'api')).toThrow();
});

test('parseSpec + searchOperations: JSON and YAML', () => {
	const yaml = parseSpec('openapi: 3.0.0\npaths:\n  /api/v1/query:\n    get:\n      summary: Instant query\n      tags: [metrics]\n  /pods:\n    post: {}\n');
	expect(searchOperations(yaml, 'METRICS')).toBe('GET /api/v1/query — Instant query');
	expect(searchOperations(yaml)).toContain('POST /pods');
	expect(() => parseSpec('{"openapi":"3.0.0"}')).toThrow('paths');
});

test('seal/unseal: roundtrip, ciphertext hides the secret', () => {
	const sealed = seal('Authorization: Bearer abc');
	expect(sealed).not.toContain('abc');
	expect(unseal(sealed)).toBe('Authorization: Bearer abc');
	// Versioned; secrets sealed before the prefix still open; unknown versions don't.
	expect(sealed.startsWith('v1.')).toBe(true);
	expect(unseal(sealed.slice(3))).toBe('Authorization: Bearer abc');
	expect(() => unseal(`v2.${sealed.slice(3)}`)).toThrow('versão');
});

test('readCapped: stops an endless body just past the limit', async () => {
	let cancelled = false;
	const endless = new ReadableStream<Uint8Array>({
		pull: (c) => c.enqueue(new Uint8Array(1024).fill(97)),
		cancel: () => {
			cancelled = true;
		},
	});
	const text = await readCapped(new Response(endless), 16 * 1024);
	expect(text.length).toBeGreaterThan(16 * 1024);
	expect(text.length).toBeLessThanOrEqual(17 * 1024);
	expect(cancelled).toBe(true);
	expect(await readCapped(new Response('{"ok":true}'), 16 * 1024)).toBe('{"ok":true}');
});

test('call_api: audit line for every call, blocked ones included', async () => {
	const audit = { workspaceId: 'w1', userId: 'u1', conversationId: 'c1' };
	const tools = apiTools([{ id: 'a1', title: 'Interna', baseUrl: 'http://127.0.0.1:9090' }], audit);
	const lines: string[] = [];
	const realInfo = console.info;
	console.info = (...args: unknown[]) => lines.push(args.join(' '));
	try {
		const execute = tools.call_api.execute as unknown as (i: object, o: object) => Promise<string>;
		const out = await execute({ api: 'a1', path: '/api/v1/query', query: { query: 'up' } }, { toolCallId: 't', messages: [] });
		expect(out).toContain('rede privada');
	} finally {
		console.info = realInfo;
	}
	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0]!.replace('[call_api] ', ''))).toMatchObject({ ...audit, api: 'a1', path: '/api/v1/query', error: expect.stringContaining('rede privada') });
});
