import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { DragOverlay, useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { useMemo } from 'react';

export type Side = 'left' | 'right';
export type Pin = { id: string; side: Side; slot: number; range: Range; content: DocumentFragment };
/** `block`: diagrama/código/tabela selecionado inteiro por clique. */
export type Selected = { range: Range; text: string; block?: HTMLElement };
export type SlotData = { side: Side; slot: number };

/** Id do arraste vindo do menu de seleção; os demais são ids de pins. */
const SELECTION = 'selection';

// Coluna da conversa é max-w-3xl (48rem): as laterais começam a 24rem do centro.
const GUTTER: Record<Side, string> = { left: 'right-[calc(50%+25rem)]', right: 'left-[calc(50%+25rem)]' };

// Trecho clonado, sem prender ao DOM da conversa (que re-renderiza).
const Fragment = ({ content }: { content: DocumentFragment }) => <div ref={(el) => el?.replaceChildren(content.cloneNode(true))} />;

// Área sob o input flutuante (pb-40 da coluna): o menu não vai para lá.
const COVERED = 160;

// Trecho maior que a área visível: a âncora vira uma linha no topo visível e o menu cai logo abaixo dela.
// Nos outros casos o flip do popover escolhe o lado (acima, ou abaixo se não couber).
function anchorRect(range: Range, boundary: HTMLElement) {
	const r = range.getBoundingClientRect();
	const v = boundary.getBoundingClientRect();
	return r.top < v.top && r.bottom > v.bottom - COVERED ? new DOMRect(r.x, v.top, r.width, 0) : r;
}

function SelectionMenu({
	selected,
	boundary,
	container,
	onClose,
	onAsk,
	onPin,
}: {
	selected: Selected;
	/** Área rolável: limite do flip e fonte dos eventos de scroll que reposicionam o menu. */
	boundary: HTMLElement;
	/** Dentro do container da conversa, para o @6xl do "Fixar" valer. */
	container: HTMLElement;
	onClose: () => void;
	/** Ausente na conversa compartilhada (só leitura). */
	onAsk?: () => void;
	/** Ausente com as laterais cheias. */
	onPin?: () => void;
}) {
	const { setNodeRef, attributes, listeners } = useDraggable({ id: SELECTION, disabled: !onPin });
	// Âncora virtual estável: o popover a re-mede no scroll, sem re-render do React. O floating-ui escuta o scroll
	// dos ancestrais do contextElement (não dele mesmo), então ele precisa estar dentro da área rolável: o próprio trecho.
	const anchor = useMemo(() => {
		const node = selected.range.commonAncestorContainer;
		const contextElement = node instanceof Element ? node : node.parentElement!;
		return { current: { contextElement, getBoundingClientRect: () => anchorRect(selected.range, boundary) } };
	}, [selected.range, boundary]);

	return (
		// Clique fora e Esc fecham (DismissableLayer do Radix).
		<Popover open onOpenChange={(open) => !open && onClose()}>
			<PopoverAnchor virtualRef={anchor} />
			<PopoverContent
				container={container}
				side='top'
				sideOffset={8}
				collisionBoundary={boundary}
				collisionPadding={{ top: 8, bottom: COVERED }}
				// Não rouba o foco (nem desfaz a seleção) ao abrir/fechar.
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
				className='[&_button:hover]:bg-accent w-auto flex-row gap-0.5 p-1 [&_button]:flex [&_button]:items-center [&_button]:gap-1.5 [&_button]:rounded-md [&_button]:px-2 [&_button]:py-1'
			>
				{/* Mantém a seleção visível ao clicar. */}
				{onAsk && (
					<button type='button' onMouseDown={(e) => e.preventDefault()} onClick={onAsk}>
						<Icon icon='text-quote' size='sm' />
						Perguntar sobre
					</button>
				)}
				{/* Só cabe nas laterais em telas largas. */}
				{onPin && (
					<button
						ref={setNodeRef}
						type='button'
						title='Arraste para uma lateral (ou clique para fixar no primeiro espaço livre)'
						onClick={onPin}
						{...attributes}
						{...listeners}
						className='hidden cursor-grab touch-none @6xl:flex'
					>
						<Icon icon='grip-vertical' size='sm' />
						Fixar
					</button>
				)}
			</PopoverContent>
		</Popover>
	);
}

function jump(range: Range) {
	const node = range.startContainer;
	(node instanceof Element ? node : node.parentElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	getSelection()?.removeAllRanges();
	getSelection()?.addRange(range);
}

function EmptySlot({ side, slot, dragging }: SlotData & { dragging: boolean }) {
	const { setNodeRef, isOver } = useDroppable({ id: side + slot, data: { side, slot } satisfies SlotData });
	return (
		<div
			ref={setNodeRef}
			className={cn(
				'text-muted-foreground flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed text-xs transition-colors',
				!dragging && 'invisible',
				isOver ? 'border-muted-foreground bg-foreground/5 text-foreground' : 'border-border',
			)}
		>
			Soltar para fixar
		</div>
	);
}

// Arrastável para outro espaço; recebe outro pin (troca de lugar), não uma seleção nova.
function PinSlot({ pin, onRemove }: { pin: Pin; onRemove: () => void }) {
	const { active } = useDndContext();
	const { setNodeRef: dropRef, isOver } = useDroppable({
		id: pin.side + pin.slot,
		data: { side: pin.side, slot: pin.slot } satisfies SlotData,
		disabled: active?.id === SELECTION,
	});
	const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: pin.id });

	return (
		// container-type size: o fade (em cqh) só cobre o trecho que passa da altura do espaço.
		<div
			ref={dropRef}
			className={cn(
				'group [container-type:size] pointer-events-auto relative min-h-0 flex-1 rounded-2xl transition-colors',
				isOver && 'bg-foreground/5',
				isDragging && 'opacity-30',
			)}
		>
			<button
				ref={setNodeRef}
				type='button'
				title='Clique para ir ao trecho; arraste para mudar de lugar'
				onClick={() => jump(pin.range)}
				{...attributes}
				{...listeners}
				className='text-muted-foreground hover:text-foreground block max-h-full w-full cursor-pointer touch-none overflow-hidden [mask-image:linear-gradient(black_calc(100cqh-3rem),transparent_100cqh)] text-left text-xs transition-colors [&_*]:text-[length:inherit]'
			>
				<Fragment content={pin.content} />
			</button>
			<button
				type='button'
				aria-label='Desafixar'
				onClick={onRemove}
				className={cn(
					'text-muted-foreground hover:text-foreground absolute top-0 cursor-pointer rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
					pin.side === 'right' ? '-right-5' : '-left-5',
				)}
			>
				<Icon icon='x' size='xs' />
			</button>
		</div>
	);
}

// Fora da área rolável: ficam parados enquanto o conteúdo rola. Espaços vazios só aparecem durante o arraste.
function Gutters({
	pins,
	slots,
	preview,
	onRemove,
}: {
	pins: Pin[];
	slots: number[];
	/** Seleção sendo arrastada do menu. */
	preview?: DocumentFragment;
	onRemove: (id: string) => void;
}) {
	const { active } = useDndContext();
	const dragged = active?.id === SELECTION ? preview : pins.find((p) => p.id === active?.id)?.content;

	return (
		<>
			{(['left', 'right'] as const).map((side) => (
				<div
					key={side}
					className={cn(
						'pointer-events-none absolute inset-y-3 hidden w-[min(20rem,calc(50%-26.5rem))] flex-col gap-3 @6xl:flex',
						GUTTER[side],
					)}
				>
					{slots.map((slot) => {
						const pin = pins.find((p) => p.side === side && p.slot === slot);
						return pin ? (
							<PinSlot key={slot} pin={pin} onRemove={() => onRemove(pin.id)} />
						) : (
							<EmptySlot key={slot} side={side} slot={slot} dragging={!!active} />
						);
					})}
				</div>
			))}

			{/* Sem animação de volta: a origem muda de lugar (ou some) no drop. */}
			<DragOverlay dropAnimation={null}>
				{dragged && (
					<div className='bg-popover text-muted-foreground ring-foreground/10 max-h-32 w-64 cursor-grabbing overflow-hidden rounded-lg [mask-image:linear-gradient(black_5rem,transparent_8rem)] p-3 text-xs shadow-md ring-1 [&_*]:text-[length:inherit]'>
						<Fragment content={dragged} />
					</div>
				)}
			</DragOverlay>
		</>
	);
}

export { Gutters, SelectionMenu };
