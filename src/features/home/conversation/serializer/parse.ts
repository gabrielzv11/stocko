// Subconjunto de markdown que o agente produz (chat.ts): parágrafos, títulos, listas, blocos de código,
// negrito/itálico, código inline, links e referências `owner/repo/caminho#Lx-Ly@sha`.
// ponytail: listas aninhadas viram itens planos e não há tabelas/citações; trocar por remark se o agente passar a usá-las.

export type Ref = { label: string; title: string; href: string };

export type Inline =
	| { type: 'text'; text: string }
	| { type: 'strong' | 'em'; children: Inline[] }
	| { type: 'link'; href: string; children: Inline[] }
	| { type: 'code'; text: string }
	| { type: 'ref'; ref: Ref };

export type Block =
	| { type: 'paragraph'; children: Inline[] }
	| { type: 'heading'; level: number; children: Inline[] }
	| { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
	| { type: 'code'; lang: string; text: string };

export const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
export const HEADING = /^(#{1,6})\s+(.*)$/;
export const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const REF = /^([\w.-]+\/[\w.-]+)\/([^#@\s]+?)(?:#L(\d+)(?:-L?(\d+))?)?@([0-9a-f]{7,40})$/;
export const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g;

export function parseRef(code: string): Ref | null {
	const m = code.match(REF);
	if (!m) return null;
	const [, repo, path, start, end, sha] = m;
	const lines = start ? `#L${start}${end ? `-L${end}` : ''}` : '';
	return {
		label: `${path.split('/').at(-1)}${start ? `:${start}${end ? `–${end}` : ''}` : ''}`,
		title: `${repo}/${path} @ ${sha}`,
		href: `https://github.com/${repo}/blob/${sha}/${path}${lines}`,
	};
}

export function parseInline(src: string): Inline[] {
	const out: Inline[] = [];
	let last = 0;
	for (const m of src.matchAll(INLINE)) {
		if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
		const [, code, strong, strong2, linkText, href, em] = m;
		if (code !== undefined) {
			const ref = parseRef(code);
			out.push(ref ? { type: 'ref', ref } : { type: 'code', text: code });
		} else if (strong !== undefined || strong2 !== undefined) {
			out.push({ type: 'strong', children: parseInline(strong ?? strong2) });
		} else if (href !== undefined) {
			out.push({ type: 'link', href, children: parseInline(linkText) });
		} else {
			out.push({ type: 'em', children: parseInline(em) });
		}
		last = m.index + m[0].length;
	}
	if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
	return out;
}

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || LIST.test(line);

export function parseBlocks(src: string): Block[] {
	const lines = src.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		const fence = line.match(FENCE);
		if (fence) {
			const body: string[] = [];
			i++;
			// Sem fechamento (resposta ainda em streaming) o bloco vai até o fim.
			while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
			i++;
			blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') });
			continue;
		}

		if (!line.trim()) {
			i++;
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
			i++;
			continue;
		}

		const first = line.match(LIST);
		if (first) {
			const ordered = /\d/.test(first[1]);
			const items: string[] = [];
			while (i < lines.length) {
				const item = lines[i].match(LIST);
				if (item && /\d/.test(item[1]) === ordered) items.push(item[2]);
				else if (!item && /^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
				else break;
				i++;
			}
			blocks.push({ type: 'list', ordered, start: ordered ? parseInt(first[1]) : 1, items: items.map(parseInline) });
			continue;
		}

		const para: string[] = [];
		while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i]))) para.push(lines[i++]);
		blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
	}

	return blocks;
}
