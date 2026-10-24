import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { type ConversationSummary, useConversations } from '@/features/home/api';
import { ConversationMenu } from '@/features/home/conversationMenu';
import { cn } from '@/lib/cn';
import { openContextMenu } from '@/lib/openContextMenu';
import { NavLink } from 'react-router-dom';
import { Profile } from '../profile';
import { navItems } from './navItems';

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onMenuClick: () => void;
}

// Mesmo breakpoint do `md:` do Tailwind
export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

const itemClass =
	'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-card';

function ConversationList({ onNavigate }: { onNavigate: () => void }) {
	const { data: conversations = [] } = useConversations();
	const pinned = conversations.filter((c) => c.pinned);
	const others = conversations.filter((c) => !c.pinned);

	return (
		<>
			<ConversationSection title='Fixadas' conversations={pinned} onNavigate={onNavigate} />
			<ConversationSection title='Recentes' conversations={others} onNavigate={onNavigate} />
		</>
	);
}

function ConversationSection({
	title,
	conversations,
	onNavigate,
}: {
	title: string;
	conversations: ConversationSummary[];
	onNavigate: () => void;
}) {
	if (!conversations.length) return null;

	return (
		<nav aria-label={title} className='flex flex-col gap-0.5'>
			<h2 className='px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground'>{title}</h2>
			{conversations.map((c) => (
				<ConversationMenu key={c.id} conversation={c}>
					<div className='group relative'>
						<NavLink
							to={`/c/${c.id}`}
							onClick={onNavigate}
							className={({ isActive }) =>
								cn(
									'flex flex-col rounded-lg py-1.5 pr-8 pl-2 text-sm transition-colors group-data-[state=open]:bg-card hover:bg-card',
									isActive && 'bg-card'
								)
							}
						>
							<span className='truncate'>{c.title || 'Sem título'}</span>
							{c.projects.length > 0 && (
								<span className='truncate text-xs text-muted-foreground'>
									{c.projects.map((p) => p.name).join(', ')}
								</span>
							)}
						</NavLink>
						<button
							type='button'
							aria-label='Opções da conversa'
							onClick={openContextMenu}
							className='absolute top-1.5 right-1 rounded-md p-1 text-muted-foreground transition-opacity outline-none group-hover:opacity-100 group-data-[state=open]:opacity-100 hover:text-foreground focus-visible:opacity-100 md:opacity-0'
						>
							<Icon icon='ellipsis-vertical' size='sm' />
						</button>
					</div>
				</ConversationMenu>
			))}
		</nav>
	);
}

function Sidebar({ collapsed, onCollapsedChange, onMenuClick, ...props }: SidebarProps) {
	const closeOnMobile = () => isMobile() && onCollapsedChange(true);

	// Recolhida, clicar em área vazia expande. Cliques em ações (ou em portais, cujo
	// evento sintético também borbulha até aqui) seguem só o próprio comportamento.
	const expandOnClick = (e: React.MouseEvent<HTMLElement>) => {
		props.onClick?.(e);
		const target = e.target as HTMLElement;
		if (
			collapsed &&
			e.currentTarget.contains(target) &&
			!target.closest('a, button, input, select, textarea, [role="button"], [role="menuitem"]')
		)
			onCollapsedChange(false);
	};

	return (
		<aside
			className={cn(
				'flex h-full shrink-0 flex-col overflow-hidden border-card-border bg-background transition-[width] duration-300 md:border-r',
				collapsed ? 'w-0 cursor-e-resize md:w-14' : 'w-full md:w-64',
				props.className
			)}
			{...props}
			onClick={expandOnClick}
		>
			<div className='flex flex-col gap-2 p-2'>
				<div className='flex justify-between'>
					<Text typography='h2' className={collapsed ? 'hidden' : ''}>
						STOCKO
					</Text>
					<IconButton
						icon='panel-left'
						variant='ghost'
						size='sm'
						aria-label='Alternar menu'
						onClick={onMenuClick}
					/>
					<IconButton
						className='md:hidden'
						icon='panel-left-close'
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

			{/* Recolhida não há espaço para títulos; o flex-1 segue empurrando o perfil para baixo. */}
			<div className='flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2'>
				{!collapsed && <ConversationList onNavigate={closeOnMobile} />}
			</div>

			<div className='border-t border-card-border p-2'>
				<Profile collapsed={collapsed} />
			</div>
		</aside>
	);
}

export { Sidebar };
