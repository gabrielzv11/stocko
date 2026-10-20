import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Profile } from '../profile';
import { navItems, pinnedItems, recentItems, type ConversationItem } from './navItems';

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}

// Mesmo breakpoint do `md:` do Tailwind
export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

const itemClass =
	'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-card';

function Section({ title, items }: { title: string; items: ConversationItem[] }) {
	if (!items.length) return null;

	return (
		<section className='flex flex-col gap-0.5'>
			<h2 className='px-2 pb-1 text-xs text-muted-foreground'>{title}</h2>
			{items.map((item) => (
				<button key={item.id} type='button' className={cn(itemClass, 'text-left')}>
					{item.icon && <Icon icon={item.icon} size='sm' className='shrink-0' />}
					<span className='truncate'>{item.title}</span>
				</button>
			))}
		</section>
	);
}

function Sidebar({ collapsed, onCollapsedChange, className, ...props }: SidebarProps) {
	const [search, setSearch] = useState('');
	const filter = (items: ConversationItem[]) =>
		items.filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()));

	const closeOnMobile = () => isMobile() && onCollapsedChange(true);

	return (
		<aside
			className={cn(
				'flex h-full shrink-0 flex-col overflow-hidden border-card-border bg-background transition-[width] duration-300 md:border-r',
				collapsed ? 'w-0 md:w-14' : 'w-full md:w-64',
				className
			)}
			{...props}
		>
			<div className='flex flex-col gap-2 p-2'>
				<div className='flex justify-end md:hidden'>
					<IconButton
						icon='x'
						variant='ghost'
						size='sm'
						aria-label='Fechar menu'
						onClick={() => onCollapsedChange(true)}
					/>
				</div>

				{collapsed ? (
					<button
						type='button'
						aria-label='Procurar'
						title='Procurar'
						onClick={() => onCollapsedChange(false)}
						className={cn(itemClass, 'justify-center')}
					>
						<Icon icon='search' size='sm' />
					</button>
				) : (
					<label className='flex items-center gap-2 rounded-lg border border-card-border px-2 py-1.5 text-sm text-muted-foreground focus-within:ring-1 focus-within:ring-ring'>
						<Icon icon='search' size='sm' className='shrink-0' />
						<input
							type='search'
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder='Procurar'
							className='w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground'
						/>
					</label>
				)}

				<nav className='flex flex-col gap-0.5'>
					{navItems.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							end
							onClick={closeOnMobile}
							aria-label={item.title}
							title={collapsed ? item.title : undefined}
							className={({ isActive }) =>
								cn(itemClass, collapsed && 'justify-center', isActive && 'bg-card font-medium')
							}
						>
							<Icon icon={item.icon} size='sm' className='shrink-0' />
							{!collapsed && <span className='truncate'>{item.title}</span>}
						</NavLink>
					))}
				</nav>
			</div>

			<div className='flex flex-1 flex-col gap-6 overflow-y-auto p-2 pt-4'>
				{!collapsed && (
					<>
						<Section title='Fixados' items={filter(pinnedItems)} />
						<Section title='Recentes' items={filter(recentItems)} />
					</>
				)}
			</div>

			<div className='border-t border-card-border p-2'>
				<Profile collapsed={collapsed} />
			</div>
		</aside>
	);
}

export { Sidebar };
