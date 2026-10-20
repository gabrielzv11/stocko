import { AnimatedShinyText } from '@/components/shared/shinyText';
import { CircularProgress } from '@/components/ui/circularProgress';
import { CopyButton } from '@/components/ui/copyButton';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Markdown } from './serializer';

export type Part =
	| { type: 'text'; text: string }
	| { type: 'reasoning'; text: string }
	| { type: 'step'; id: string; label: string; done: boolean; failed: boolean };
export type Message = { id: string; role: 'user' | 'assistant'; parts: Part[]; streaming?: boolean };

type Activity = Exclude<Part, { type: 'text' }>;
type Block = { kind: 'text'; text: string } | { kind: 'activity'; items: Activity[] };

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	messages: Message[];
	typing?: boolean;
}

const textOf = (message: Message) => message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n');

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
	const listRef = useRef<HTMLUListElement>(null);
	const total = items.reduce((n, item) => n + (item.type === 'reasoning' ? item.text.length : 0), 0);
	const shown = useReveal(total, live);
	const revealing = shown < total;
	const steps = items.filter((item) => item.type === 'step').length;
	const summary =
		live || revealing
			? 'Trabalhando…'
			: steps
				? `Consultou o código · ${steps} ${steps === 1 ? 'passo' : 'passos'}`
				: 'Raciocínio';

	useEffect(() => {
		if (revealing) listRef.current?.scrollIntoView({ block: 'end' });
	}, [shown, revealing]);

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
			<ul ref={listRef} className='border-border mt-2 ml-1.5 flex flex-col gap-1.5 border-l pl-3'>
				{visible.map((item, i) =>
					item.type === 'step' ? (
						<li key={item.id} className='flex items-center gap-2'>
							{item.done ? (
								<Icon
									icon={item.failed ? 'x' : 'check'}
									size='xs'
									className={cn('shrink-0', item.failed && 'text-red-500')}
								/>
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
					)
				)}
			</ul>
		</details>
	);
}

function Conversation({ messages, typing, className, ...props }: Props) {
	const endRef = useRef<HTMLDivElement>(null);
	const last = messages.at(-1);
	const tail = last?.parts.at(-1);
	// "Digitando" até algo chegar, e de novo entre um passo concluído e o próximo pedaço do modelo
	const waiting = typing && (last?.role === 'user' || (tail?.type === 'step' && tail.done));
	const tailSize = tail?.type === 'step' ? tail.label.length : tail?.text.length;

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [messages.length, last?.parts.length, tailSize, waiting]);

	return (
		<div className={cn('overflow-y-auto', className)} {...props}>
			<div className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
				{messages.map((message) =>
					message.role === 'user' ? (
						<div key={message.id} className='flex max-w-[85%] flex-col items-end gap-2 self-end'>
							<div className='bg-card rounded-2xl px-4 py-2.5 whitespace-pre-wrap'>{textOf(message)}</div>
							<CopyButton text={textOf(message).trim()} label='Copiar pergunta' />
						</div>
					) : (
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
								<CopyButton
									text={textOf(message).trim()}
									label='Copiar resposta'
									className='-mt-2 self-start'
								/>
							)}
						</div>
					)
				)}

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

				<div ref={endRef} />
			</div>
		</div>
	);
}

export { Conversation };
