import { FENCE, HEADING, INLINE, LIST } from './parse';

// Versão "ao vivo" do parser para o editor: cada caractere do markdown continua no DOM (o texto do
// editor é sempre o markdown cru), só que estilizado. Marcadores (#, **, `, [](...)) somem fora da
// linha do cursor (`data-active`), no estilo do live preview do Obsidian.
// ponytail: linha a linha, sem o contexto de parágrafo do parseBlocks; basta para o que o usuário digita.

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const mark = (s: string) => `<span class="text-muted-foreground hidden group-data-active:inline">${esc(s)}</span>`;

function inline(src: string): string {
	let out = '';
	let last = 0;
	for (const m of src.matchAll(INLINE)) {
		out += esc(src.slice(last, m.index));
		const [all, code, strong, strong2, linkText, , em] = m;
		if (code !== undefined) {
			out += `${mark('`')}<code class="bg-muted rounded-md px-1 font-mono text-[0.85em]">${esc(code)}</code>${mark('`')}`;
		} else if (strong !== undefined || strong2 !== undefined) {
			const d = all.slice(0, 2);
			out += `${mark(d)}<strong class="font-semibold">${inline(strong ?? strong2)}</strong>${mark(d)}`;
		} else if (linkText !== undefined) {
			out += `${mark('[')}<span class="underline underline-offset-2">${inline(linkText)}</span>${mark(all.slice(linkText.length + 1))}`;
		} else {
			out += `${mark('*')}<em>${inline(em)}</em>${mark('*')}`;
		}
		last = m.index + all.length;
	}
	return out + esc(src.slice(last));
}

/** Markdown → HTML do editor. `textContent` do resultado é exatamente `src`. */
export function highlight(src: string, activeLine = -1): string {
	let fence: string | null = null;
	const lines = src.split('\n').map((line, i) => {
		let cls = '';
		let html: string;
		const f = !fence && line.match(FENCE);
		const heading = !fence && !f && line.match(HEADING);
		const list = !fence && !f && !heading && line.match(LIST);

		if (fence || f) {
			cls = 'font-mono text-sm';
			if (f) fence = f[1];
			else if (line.trimStart().startsWith(fence!)) fence = null;
			html = f || !fence ? `<span class="text-muted-foreground">${esc(line)}</span>` : esc(line);
		} else if (heading) {
			cls = heading[1].length === 1 ? 'text-xl font-semibold' : 'text-lg font-semibold';
			html = mark(line.slice(0, line.length - heading[2].length)) + inline(heading[2]);
		} else if (list) {
			html = `<span class="text-muted-foreground">${esc(line.slice(0, line.length - list[2].length))}</span>${inline(list[2])}`;
		} else {
			html = inline(line);
		}
		return `<span class="group ${cls}"${i === activeLine ? ' data-active' : ''}>${html}</span>`;
	});
	// Sem o <br>, uma quebra de linha no fim não aparece no contentEditable.
	return lines.join('\n') + (src.endsWith('\n') ? '<br>' : '');
}
