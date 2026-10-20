'use client';

import { cn } from '@/lib/cn';
import { useEffect, useRef, type MouseEvent } from 'react';

interface ListProps<T extends { id: React.Key }> extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
	items: T[];
	renderItem: (item: T) => React.ReactNode;
	onItemClick?: (item: T) => void;
}

const LERP = 0.25;

/** Fundo de hover único que desliza (lerp via rAF) até o item sob o mouse. */
function useHoverLerp() {
	const bar = useRef<HTMLDivElement>(null);
	const alvo = useRef({ y: 0, h: 0 });
	const atual = useRef({ y: 0, h: 0 });
	const raf = useRef(0);
	const visivel = useRef(false);

	const tick = () => {
		const a = atual.current;
		const t = alvo.current;
		a.y += (t.y - a.y) * LERP;
		a.h += (t.h - a.h) * LERP;
		const fim = Math.abs(t.y - a.y) < 0.1 && Math.abs(t.h - a.h) < 0.1;
		if (fim) Object.assign(a, t);
		if (bar.current) {
			bar.current.style.transform = `translateY(${a.y}px)`;
			bar.current.style.height = `${a.h}px`;
		}
		raf.current = fim ? 0 : requestAnimationFrame(tick);
	};

	useEffect(() => () => cancelAnimationFrame(raf.current), []);

	const onMouseOver = (e: MouseEvent) => {
		const el = (e.target as Element).closest<HTMLElement>('[data-hover]');
		if (!el || !bar.current) return;
		// offset* relativo ao <main> (offsetParent, pois é relative)
		alvo.current = { y: el.offsetTop, h: el.offsetHeight };
		bar.current.style.left = `${el.offsetLeft}px`;
		bar.current.style.width = `${el.offsetWidth}px`;
		if (!visivel.current) {
			atual.current = { ...alvo.current }; // primeira entrada: sem deslizar de longe
			visivel.current = true;
			bar.current.style.opacity = '1';
		}
		if (!raf.current) raf.current = requestAnimationFrame(tick);
	};

	const onMouseLeave = () => {
		visivel.current = false;
		if (bar.current) bar.current.style.opacity = '0';
	};

	return { bar, onMouseOver, onMouseLeave };
}

function List<T extends { id: React.Key }>({
	items,
	renderItem,
	onItemClick,
	className,
	...props
}: ListProps<T>) {
	const hover = useHoverLerp();

	return (
		<main
			onMouseOver={hover.onMouseOver}
			onMouseLeave={hover.onMouseLeave}
			className={cn('relative px-12', className)}
			{...props}
		>
			<div
				ref={hover.bar}
				aria-hidden='true'
				className='bg-muted pointer-events-none absolute top-0 z-0 opacity-0 transition-opacity duration-150'
			/>
			{items.map((item, index) => (
				<div
					key={item.id}
					data-hover
					onClick={() => onItemClick?.(item)}
					className={cn(
						'relative flex cursor-pointer justify-between gap-4 p-4 lg:max-h-56',
						index === items.length - 1 ? '' : 'border-border border-b'
					)}
				>
					<div className='relative z-10 flex w-full justify-between gap-4'>{renderItem(item)}</div>
				</div>
			))}
		</main>
	);
}

export { List };
