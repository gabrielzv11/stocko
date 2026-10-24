import { AnimatedShinyText } from '@/components/shared/shinyText';
import { CircularProgress } from '@/components/ui/circularProgress';
import { CopyButton } from '@/components/ui/copyButton';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { DndContext, PointerSensor, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Feedback } from './feedback';
import { Gutters, SelectionMenu, type Pin, type Selected, type Side, type SlotData } from './pins';
import { Markdown } from './serializer';

export type Part =
	| { type: 'text'; text: string }
	| { type: 'reasoning'; text: string }
	| { type: 'step'; id: string; label: string; done: boolean; failed: boolean };
export type Message = { id: string; role: 'user' | 'assistant'; parts: Part[]; streaming?: boolean; feedback?: 1 | -1 | null };

type Activity = Exclude<Part, { type: 'text' }>;
type Block = { kind: 'text'; text: string } | { kind: 'activity'; items: Activity[] };

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	messages: Message[];
	typing?: boolean;
	/** "Perguntar sobre" um trecho selecionado. */
	onAsk?: (quote: string) => void;
	/** Conversa compartilhada: sem 👍/👎 (pede login). */
	readOnly?: boolean;
}

const textOf = (message: Message) => message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n');

/** Separa a citação ("> ..." no início, ver Chat.send) do resto da pergunta. */
function splitQuote(text: string) {
	const lines = text.split('\n');
	const end = lines.findIndex((line) => !line.startsWith('>'));
	const cut = end === -1 ? lines.length : end;
	return {
		quote: lines
			.slice(0, cut)
			.map((line) => line.replace(/^> ?/, ''))
			.join('\n'),
		text: lines.slice(cut).join('\n').trim(),
	};
}

/** Passos e raciocínio consecutivos viram um bloco de atividade entre os trechos de texto. */
function toBlocks(parts: Part[]) {
	const blocks: Block[] = [];
	for (const part of parts) {
		const prev = blocks.at(-1);
		if (part.type === 'text') blocks.push({ kind: 'text', text: part.text });
		else if (prev?.kind === 'activity') prev.items.push(part);
		else blocks.push({ kind: 'activity', items: [part] });
	}
	return blocks;
}

/** Cópia do trecho para pins e preview, sem botões (copiar, zoom) nem o contorno de seleção. */
function clone(range: Range) {
	const content = range.cloneContents();
	content.querySelectorAll('button').forEach((b) => b.remove());
	content.querySelectorAll('[data-selected]').forEach((el) => el.removeAttribute('data-selected'));
	return content;
}

/** Blocos fixados por lateral: cada um ocupa uma faixa fixa, sem sobrepor. */
const SLOTS = [0, 1, 2];

const REVEAL_CPS = 45;

// Revela `length` caracteres em ritmo constante, absorvendo as rajadas irregulares do modelo.
// Atraso acima de ~2s acelera proporcionalmente, para não ficar para trás indefinidamente.
function useReveal(length: number, animate: boolean) {
	const [shown, setShown] = useState(animate ? 0 : length);
	useEffect(() => {
		if (shown >= length) return;
		const step = Math.max(1, Math.ceil((length - shown) / (REVEAL_CPS * 2)));
		const id = setTimeout(() => setShown((s) => Math.min(length, s + step)), 1000 / REVEAL_CPS);
		return () => clearTimeout(id);
	}, [shown, length]);
	return shown;
}

// Aberto enquanto o agente trabalha (e até o raciocínio terminar de aparecer); recolhe sozinho depois.
function ActivityLog({ items, live }: { items: Activity[]; live: boolean }) {
	const total = items.reduce((n, item) => n + (item.type === 'reasoning' ? item.text.length : 0), 0);
	const shown = useReveal(total, live);
	const revealing = shown < total;
	const steps = items.filter((item) => item.type === 'step').length;
	const summary = live || revealing ? 'Trabalhando…' : steps ? `Consultou o código · ${steps} ${steps === 1 ? 'passo' : 'passos'}` : 'Raciocínio';

	// Itens depois de um raciocínio ainda incompleto esperam, para manter a ordem.
	let budget = shown;
	let blocked = false;
	const visible = items.flatMap((item): Activity[] => {
		if (blocked) return [];
		if (item.type !== 'reasoning') return [item];
		const text = item.text.slice(0, budget);
		budget -= text.length;
		blocked = text.length < item.text.length;
		return text ? [{ ...item, text }] : [];
	});

	return (
		<details open={live || revealing} className='group text-muted-foreground text-sm'>
			<summary className='hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 select-none [&::-webkit-details-marker]:hidden'>
				<Icon icon='chevron-right' size='xs' className='transition-transform group-open:rotate-90' />
				{summary}
			</summary>
			<ul className='border-border mt-2 ml-1.5 flex flex-col gap-1.5 border-l pl-3'>
				{visible.map((item, i) =>
					item.type === 'step' ? (
						<li key={item.id} className='flex items-center gap-2'>
							{item.done ? (
								<Icon icon={item.failed ? 'x' : 'check'} size='xs' className={cn('shrink-0', item.failed && 'text-red-500')} />
							) : (
								<CircularProgress className='size-3 shrink-0' />
							)}
							{/* Passos duram ms; brilho segue o turno inteiro, não cada passo. */}
							{live ? (
								<AnimatedShinyText className='mx-0 max-w-none truncate'>{item.label}</AnimatedShinyText>
							) : (
								<span className='truncate'>{item.label}</span>
							)}
						</li>
					) : (
						<li key={i} className='whitespace-pre-wrap italic'>
							{item.text}
						</li>
					),
				)}
			</ul>
		</details>
	);
}

function Conversation({ messages, typing, onAsk, readOnly, className, ...props }: Props) {
	const contentRef = useRef<HTMLDivElement>(null);
	// Acompanha o fim só enquanto o usuário está lá; rolar para cima solta.
	const stick = useRef(true);
	const [selected, setSelected] = useState<Selected | null>(null);
	const [pins, setPins] = useState<Pin[]>([]);
	// Estado (não ref): o menu recebe os elementos como props no render.
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const range = selected?.range;
	const preview = useMemo(() => (range ? clone(range) : undefined), [range]);
	const down = useRef({ x: 0, y: 0 });
	// Distância mínima: clique em "Fixar" sem arrastar continua sendo clique.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	const last = messages.at(-1);
	const tail = last?.parts.at(-1);
	// "Digitando" até algo chegar, e de novo entre um passo concluído e o próximo pedaço do modelo
	const waiting = typing && (last?.role === 'user' || (tail?.type === 'step' && tail.done));

	// Qualquer crescimento (chunks, reveal do raciocínio, diagramas carregando) segue o fim se grudado.
	useEffect(() => {
		if (!scroller || !contentRef.current) return;
		const observer = new ResizeObserver(() => {
			if (stick.current) scroller.scrollTo({ top: scroller.scrollHeight });
		});
		observer.observe(contentRef.current);
		return () => observer.disconnect();
	}, [scroller]);

	// Pergunta enviada: volta a acompanhar, mesmo se estava lendo lá em cima.
	const lastRole = last?.role;
	useLayoutEffect(() => {
		if (lastRole !== 'user' || !scroller) return;
		stick.current = true;
		scroller.scrollTo({ top: scroller.scrollHeight });
	}, [messages.length, lastRole, scroller]);

	// Contorno no bloco selecionado por clique (não há seleção nativa para mostrar).
	const block = selected?.block;
	useEffect(() => {
		block?.toggleAttribute('data-selected', true);
		return () => void block?.toggleAttribute('data-selected', false);
	}, [block]);

	function select(e: React.PointerEvent) {
		const target = e.target as Element;
		const sel = getSelection();
		let range: Range;
		let text: string;
		let block: HTMLElement | undefined;
		if (sel?.rangeCount && sel.toString().trim()) {
			range = sel.getRangeAt(0).cloneRange();
			text = sel.toString().trim();
		} else {
			// Clique sem arrastar (arrastar é pan no diagrama) em diagrama, código ou tabela seleciona o bloco inteiro.
			block = target.closest<HTMLElement>('[data-block]') ?? undefined;
			const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 5;
			if (!block || moved || target.closest('button, a')) return setSelected(null);
			range = document.createRange();
			range.selectNode(block);
			text = block.dataset.block || block.innerText;
		}
		setSelected({ range, text, block });
	}

	function done() {
		setSelected(null);
		getSelection()?.removeAllRanges();
	}

	const free = (['right', 'left'] as const)
		.flatMap((side) => SLOTS.map((slot) => ({ side, slot })))
		.find(({ side, slot }) => !pins.some((p) => p.side === side && p.slot === slot));

	function pin(side: Side, slot: number) {
		if (!selected) return;
		const { range } = selected;
		setPins((prev) => [...prev, { id: crypto.randomUUID(), side, slot, range, content: clone(range) }]);
		done();
	}

	// Espaço ocupado: os dois trocam de lugar.
	function move(id: string, to: SlotData) {
		setPins((prev) => {
			const from = prev.find((p) => p.id === id)!;
			return prev.map((p) =>
				p.id === id ? { ...p, ...to } : p.side === to.side && p.slot === to.slot ? { ...p, side: from.side, slot: from.slot } : p,
			);
		});
	}

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragEnd={({ active, over }) => {
				if (!over) return;
				const to = over.data.current as SlotData;
				if (pins.some((p) => p.id === active.id)) move(String(active.id), to);
				// Seleção nova só entra em espaço vazio (os ocupados nem aceitam o drop).
				else pin(to.side, to.slot);
			}}
		>
			<div ref={setRoot} className={cn('@container relative flex flex-col', className)} {...props}>
				<div
					// Gutter dos dois lados: centro da coluna bate com o do input flutuante (centrado no container todo).
					ref={setScroller}
					className='min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto'
					onScroll={(e) => {
						const el = e.currentTarget;
						stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
					}}
					onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
					onPointerUp={select}
				>
					<div ref={contentRef} className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-40'>
						{messages.map((message) => {
							if (message.role === 'user') {
								const { quote, text } = splitQuote(textOf(message));
								return (
									<div key={message.id} className='flex max-w-[85%] flex-col items-end gap-2 self-end'>
										{quote && (
											<div className='text-muted-foreground flex items-start gap-1.5 text-sm'>
												<Icon icon='text-quote' size='xs' className='mt-1 shrink-0' />
												<span className='line-clamp-2'>{quote}</span>
											</div>
										)}
										<div className='bg-card rounded-2xl px-4 py-2.5 whitespace-pre-wrap'>{text}</div>
										<CopyButton text={textOf(message).trim()} label='Copiar pergunta' />
									</div>
								);
							}
							return (
								<div key={message.id} className='flex flex-col gap-4'>
									{toBlocks(message.parts).map((block, i, blocks) => {
										const live = !!message.streaming && i === blocks.length - 1;
										return block.kind === 'activity' ? (
											<ActivityLog key={i} items={block.items} live={live} />
										) : (
											<Markdown key={i} text={block.text} streaming={message.streaming} />
										);
									})}
									{!message.streaming && (
										<div className='-mt-2 flex self-start'>
											<CopyButton text={textOf(message).trim()} label='Copiar resposta' />
											{!readOnly && <Feedback messageId={message.id} initial={message.feedback ?? null} />}
										</div>
									)}
								</div>
							);
						})}

						{waiting && (
							<div role='status' aria-label='Digitando' className='flex gap-1 py-2'>
								{[0, 1, 2].map((i) => (
									<motion.span
										key={i}
										className='bg-muted-foreground size-2 rounded-full'
										animate={{ opacity: [0.3, 1, 0.3] }}
										transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
									/>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Fora da área rolável: eventos do menu (portal) não chegam ao onPointerUp dela. */}
				{selected && root && scroller && (
					<SelectionMenu
						selected={selected}
						boundary={scroller}
						container={root}
						onClose={() => setSelected(null)}
						onAsk={
							onAsk &&
							(() => {
								onAsk(selected.text);
								done();
							})
						}
						onPin={free && (() => pin(free.side, free.slot))}
					/>
				)}
				<Gutters pins={pins} slots={SLOTS} preview={preview} onRemove={(id) => setPins((prev) => prev.filter((p) => p.id !== id))} />
			</div>
		</DndContext>
	);
}

export { Conversation };
