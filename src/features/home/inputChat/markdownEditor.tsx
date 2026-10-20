import { highlight } from '@/features/home/conversation/serializer/highlight';
import { cn } from '@/lib/cn';
import { useEffect, useLayoutEffect, useRef } from 'react';

// O DOM é reescrito a cada tecla a partir do markdown; o cursor é salvo/restaurado como offset no texto cru
// (Range.toString inclui marcadores ocultos, então bate 1:1 com o markdown).
// ponytail: sem desfazer (Ctrl+Z é bloqueado porque o histórico nativo quebra com innerHTML); pilha própria se fizer falta.

type Caret = [number, number];

function getCaret(root: HTMLElement): Caret | null {
	const sel = getSelection();
	if (!sel?.rangeCount) return null;
	const range = sel.getRangeAt(0);
	if (!root.contains(range.startContainer)) return null;
	const before = document.createRange();
	before.selectNodeContents(root);
	before.setEnd(range.startContainer, range.startOffset);
	const start = before.toString().length;
	return [start, start + range.toString().length];
}

function pointAt(root: HTMLElement, offset: number): [Node, number] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let last: Text | null = null;
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		// `<`: no limite entre nós, prefere o início do próximo (início da linha seguinte, depois de um marcador).
		if (offset < node.length) return [node, offset];
		offset -= node.length;
		last = node;
	}
	return last ? [last, last.length] : [root, 0];
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length - 1;

function render(root: HTMLElement, text: string, caret: Caret | null) {
	root.innerHTML = highlight(text, caret ? lineOf(text, caret[0]) : -1);
	if (!caret) return;
	const range = document.createRange();
	range.setStart(...pointAt(root, caret[0]));
	range.setEnd(...pointAt(root, caret[1]));
	getSelection()?.removeAllRanges();
	getSelection()?.addRange(range);
}

function insert(root: HTMLElement, str: string, onChange: (value: string) => void) {
	const text = root.textContent ?? '';
	const [start, end] = getCaret(root) ?? [text.length, text.length];
	const next = text.slice(0, start) + str + text.slice(end);
	render(root, next, [start + str.length, start + str.length]);
	onChange(next);
}

interface Props {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholder?: string;
	className?: string;
}

/** Campo de texto que formata o markdown enquanto o usuário digita ("# título" vira título na hora). */
export function MarkdownEditor({ value, onChange, onSubmit, placeholder, className }: Props) {
	const ref = useRef<HTMLDivElement>(null);

	// Valor vindo de fora (limpar após enviar): só reescreve se divergir do DOM.
	useLayoutEffect(() => {
		const root = ref.current!;
		if (root.textContent === value) return;
		render(root, value, document.activeElement === root ? [value.length, value.length] : null);
	}, [value]);

	useEffect(() => {
		const root = ref.current!;
		function onSelectionChange() {
			const caret = getCaret(root);
			const active = caret ? lineOf(root.textContent ?? '', caret[0]) : -1;
			root.querySelectorAll(':scope > span').forEach((el, i) => el.toggleAttribute('data-active', i === active));
		}
		function onBeforeInput(e: InputEvent) {
			if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
				// Enter no teclado virtual (desktop já foi tratado no keydown).
				e.preventDefault();
				insert(root, '\n', onChange);
			} else if (/^history|^insertFromDrop/.test(e.inputType)) {
				e.preventDefault();
			}
		}
		document.addEventListener('selectionchange', onSelectionChange);
		root.addEventListener('beforeinput', onBeforeInput);
		return () => {
			document.removeEventListener('selectionchange', onSelectionChange);
			root.removeEventListener('beforeinput', onBeforeInput);
		};
	}, [onChange]);

	function sync() {
		const root = ref.current!;
		const text = root.textContent ?? '';
		render(root, text, getCaret(root));
		onChange(text);
	}

	return (
		<div className={cn('relative overflow-y-auto px-2 py-3 text-base', className)}>
			{!value && <span className='text-muted-foreground pointer-events-none absolute'>{placeholder}</span>}
			<div
				ref={ref}
				contentEditable='plaintext-only'
				role='textbox'
				aria-multiline
				aria-label={placeholder}
				className='min-h-full break-words whitespace-pre-wrap outline-none'
				onInput={(e) => !(e.nativeEvent as InputEvent).isComposing && sync()}
				onCompositionEnd={sync}
				onPaste={(e) => {
					e.preventDefault();
					insert(e.currentTarget, e.clipboardData.getData('text/plain'), onChange);
				}}
				onKeyDown={(e) => {
					if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
					// Enter envia, Shift+Enter quebra linha
					e.preventDefault();
					if (e.shiftKey) insert(e.currentTarget, '\n', onChange);
					else onSubmit();
				}}
			/>
		</div>
	);
}
