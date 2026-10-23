// bun test src/features/home/conversation/serializer
import { expect, test } from 'bun:test';
import { parseBlocks, parseInline, parseRef } from './parse';

test('referência vira link curto para o GitHub', () => {
	expect(parseRef('gabrielzv11/crivo/src/utils/extractFromPdf.ts#L44-L66@e33b361')).toEqual({
		label: 'extractFromPdf.ts:44–66',
		title: 'gabrielzv11/crivo/src/utils/extractFromPdf.ts @ e33b361',
		href: 'https://github.com/gabrielzv11/crivo/blob/e33b361/src/utils/extractFromPdf.ts#L44-L66',
	});
	expect(parseRef('gabrielzv11/crivo/src/a.ts#L28@e33b361')?.label).toBe('a.ts:28');
	expect(parseRef('gabrielzv11/crivoai-app')).toBeNull();
	expect(parseRef('application/pdf')).toBeNull();
});

test('inline: negrito, código, itálico e referência', () => {
	expect(parseInline('**Resposta curta:** não, `null` e *só* `o/r/x.ts#L1@abcdef1`')).toEqual([
		{ type: 'strong', children: [{ type: 'text', text: 'Resposta curta:' }] },
		{ type: 'text', text: ' não, ' },
		{ type: 'code', text: 'null' },
		{ type: 'text', text: ' e ' },
		{ type: 'em', children: [{ type: 'text', text: 'só' }] },
		{ type: 'text', text: ' ' },
		{ type: 'ref', ref: parseRef('o/r/x.ts#L1@abcdef1')! },
	]);
});

test('blocos: parágrafo, lista numerada, código (inclusive sem fechar)', () => {
	const blocks = parseBlocks('Intro\n\n1. um\n   cont\n2. dois\n\n```ts\nconst a = 1;\n```\nfim\n\n```js\nlet b');
	expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'code', 'paragraph', 'code']);
	expect(blocks[1]).toMatchObject({ ordered: true, start: 1, items: [[{ text: 'um cont' }], [{ text: 'dois' }]] });
	expect(blocks[2]).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;', closed: true });
	expect(blocks[4]).toEqual({ type: 'code', lang: 'js', text: 'let b', closed: false });
});

test('lista sem linha em branco antes interrompe parágrafo só depois da primeira linha', () => {
	expect(parseBlocks('Como funciona:\n- a\n- b').map((b) => b.type)).toEqual(['paragraph', 'list']);
});

test('tabela GFM interrompe parágrafo e termina na linha sem `|`', () => {
	const blocks = parseBlocks('Notas:\n| C | Nota |\n|:--|--:|\n| **C1** | 0, 40 |\n| a \\| b | 200 |\nfim');
	expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'table', 'paragraph']);
	expect(blocks[1]).toMatchObject({
		head: [[{ text: 'C' }], [{ text: 'Nota' }]],
		rows: [
			[[{ type: 'strong' }], [{ text: '0, 40' }]],
			[[{ text: 'a | b' }], [{ text: '200' }]],
		],
	});
	expect(parseBlocks('| a | b |').map((b) => b.type)).toEqual(['paragraph']); // sem separador ainda (streaming)
});

test('highlight: texto do editor continua sendo o markdown cru', async () => {
	const { highlight } = await import('./highlight');
	const src = '# Título **x**\n- item `a<b>`\n```ts\n# não é título\n```\n[link](https://a.b) *e*\n';
	const html = highlight(src, 0);
	const text = html
		.replace(/<br>$/, '')
		.replace(/<[^>]+>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
	expect(text).toBe(src);
	expect(html).toMatch(/^<span class="group text-xl font-semibold" data-active>/);
	expect(html.match(/font-semibold"/g)?.length).toBe(1 + 1); // título + negrito; "# não é título" fica no bloco de código
	expect(html.endsWith('<br>')).toBe(true);
});
