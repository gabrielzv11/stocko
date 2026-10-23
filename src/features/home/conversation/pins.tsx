import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { DragOverlay, useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';

export type Side = 'left' | 'right';
export type Pin = { id: string; side: Side; slot: number; range: Range; content: DocumentFragment };
export type Selected = { range: Range; x: number; y: number };
export type SlotData = { side: Side; slot: number };

// Coluna da conversa é max-w-3xl (48rem): as laterais começam a 24rem do centro.
const GUTTER: Record<Side, string> = { left: 'right-[calc(50%+25rem)]', right: 'left-[calc(50%+25rem)]' };

// Trecho clonado, sem prender ao DOM da conversa (que re-renderiza).
const Fragment = ({ content }: { content: DocumentFragment }) => <div ref={(el) => el?.replaceChildren(content.cloneNode(true))} />;

function SelectionMenu({
	selected,
	onAsk,
	onPin,
	ref,
}: {
	selected: Selected;
	onAsk: () => void;
	/** Ausente com as laterais cheias. */
	onPin?: () => void;
	ref: React.Ref<HTMLDivElement>;
}) {
	const { setNodeRef, attributes, listeners } = useDraggable({ id: 'selection', disabled: !onPin });

	return (
		<div
			ref={ref}
			style={{ left: selected.x, top: selected.y }}
			className='bg-popover text-popover-foreground ring-foreground/10 [&_button:hover]:bg-accent absolute z-10 flex -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] gap-0.5 rounded-lg p-1 text-sm shadow-md ring-1 [&_button]:flex [&_button]:items-center [&_button]:gap-1.5 [&_button]:rounded-md [&_button]:px-2 [&_button]:py-1'
		>
			{/* Mantém a seleção visível ao clicar. */}
			<button type='button' onMouseDown={(e) => e.preventDefault()} onClick={onAsk}>
				<Icon icon='text-quote' size='sm' />
				Perguntar sobre
			</button>
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
		</div>
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

// Fora da área rolável: ficam parados enquanto o conteúdo rola. Espaços vazios só aparecem durante o arraste.
function Gutters({
	pins,
	slots,
	preview,
	onRemove,
}: {
	pins: Pin[];
	slots: number[];
	/** Trecho sendo arrastado. */
	preview?: DocumentFragment;
	onRemove: (id: string) => void;
}) {
	const dragging = !!useDndContext().active;

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
						if (!pin) return <EmptySlot key={slot} side={side} slot={slot} dragging={dragging} />;
						return (
							// container-type size: o fade (em cqh) só cobre o trecho que passa da altura do espaço.
							<div key={slot} className='group [container-type:size] pointer-events-auto relative min-h-0 flex-1'>
								<button
									type='button'
									onClick={() => jump(pin.range)}
									className='text-muted-foreground hover:text-foreground block max-h-full w-full cursor-pointer overflow-hidden [mask-image:linear-gradient(black_calc(100cqh-3rem),transparent_100cqh)] text-left text-xs transition-colors [&_*]:text-[length:inherit]'
								>
									<Fragment content={pin.content} />
								</button>
								<button
									type='button'
									aria-label='Desafixar'
									onClick={() => onRemove(pin.id)}
									className={cn(
										'text-muted-foreground hover:text-foreground absolute top-0 cursor-pointer rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
										side === 'right' ? '-right-5' : '-left-5',
									)}
								>
									<Icon icon='x' size='xs' />
								</button>
							</div>
						);
					})}
				</div>
			))}

			{/* Sem animação de volta: o menu (origem) some no drop. */}
			<DragOverlay dropAnimation={null}>
				{dragging && preview && (
					<div className='bg-popover text-muted-foreground ring-foreground/10 max-h-32 w-64 cursor-grabbing overflow-hidden rounded-lg [mask-image:linear-gradient(black_5rem,transparent_8rem)] p-3 text-xs shadow-md ring-1 [&_*]:text-[length:inherit]'>
						<Fragment content={preview} />
					</div>
				)}
			</DragOverlay>
		</>
	);
}

export { Gutters, SelectionMenu };
