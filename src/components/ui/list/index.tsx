'use client';

import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { useId, useState } from 'react';

interface ListProps<T extends { id: React.Key }> extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
	items: T[];
	renderItem: (item: T) => React.ReactNode;
	onItemClick?: (item: T) => void;
}

function List<T extends { id: React.Key }>({
	items,
	renderItem,
	onItemClick,
	className,
	...props
}: ListProps<T>) {
	const [hoveredId, setHoveredId] = useState<React.Key | null>(null);
	const layoutId = useId();

	return (
		<main className={cn('px-12', className)} {...props}>
			{items.map((item, index) => (
				<div
					key={item.id}
					onMouseEnter={() => setHoveredId(item.id)}
					onMouseLeave={() => setHoveredId(null)}
					onClick={() => onItemClick?.(item)}
					className={cn(
						'relative flex cursor-pointer justify-between gap-4 p-4 lg:max-h-56',
						index === items.length - 1 ? '' : 'border-border border-b'
					)}
				>
					{hoveredId === item.id && (
						<motion.div
							layoutId={layoutId}
							className='bg-muted absolute inset-0'
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{
								type: 'spring',
								stiffness: 80,
								damping: 10,
								mass: 0.5,
							}}
							style={{ zIndex: 0 }}
						/>
					)}

					<div className='relative z-10 flex w-full justify-between gap-4'>{renderItem(item)}</div>
				</div>
			))}
		</main>
	);
}

export { List };
