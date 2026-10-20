import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { NavLink } from 'react-router-dom';
import { Profile } from '../profile';
import { navItems } from './navItems';

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
}

// Mesmo breakpoint do `md:` do Tailwind
export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

const itemClass =
	'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-card';

function Sidebar({ collapsed, onCollapsedChange, className, ...props }: SidebarProps) {
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

			<div className='flex-1' />

			<div className='border-t border-card-border p-2'>
				<Profile collapsed={collapsed} />
			</div>
		</aside>
	);
}

export { Sidebar };
