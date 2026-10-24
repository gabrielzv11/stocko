import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdownMenu';
import { Icon } from '@/components/ui/icons';
import { api } from '@/lib/api';
import { clearToken, githubInstallUrl } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { createWorkspace, switchWorkspace, useMe } from '@/lib/me';
import { useNavigate } from 'react-router-dom';

async function logout() {
	await api.post('/auth/logout').catch(() => {});
	clearToken();
	window.location.assign('/login');
}

interface Props {
	collapsed?: boolean;
}

function Profile({ collapsed }: Props) {
	const navigate = useNavigate();
	const { data: me } = useMe();
	const name = me?.name ?? me?.login ?? '';
	const initials = name
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase())
		.join('');

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						aria-label='Perfil'
						className={cn(
							'hover:bg-card data-[state=open]:bg-card flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap transition-colors outline-none',
							collapsed && 'justify-center px-0'
						)}
					>
						{me?.avatarUrl ? (
							<img src={me.avatarUrl} alt='' className='size-8 shrink-0 rounded-full' />
						) : (
							<span className='bg-card flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
								{initials}
							</span>
						)}
						{!collapsed && (
							<>
								<span className='flex-1 truncate text-left'>{name}</span>
								<Icon icon='chevron-up' size='sm' className='text-muted-foreground' />
							</>
						)}
					</button>
				</DropdownMenuTrigger>

				<DropdownMenuContent className='w-max' side='top'>
					{me && (me.workspaces.length > 1 || me.canCreateWorkspace) && (
						<>
							<DropdownMenuLabel className='text-muted-foreground text-xs'>Workspace</DropdownMenuLabel>
							<DropdownMenuGroup>
								{me.workspaces.map((w) => (
									<DropdownMenuItem key={w.id} disabled={w.id === me.workspaceId} onSelect={() => switchWorkspace(w.id)}>
										<Icon icon='check' size='sm' className={cn(w.id !== me.workspaceId && 'invisible')} />
										{w.name}
									</DropdownMenuItem>
								))}
								{me.canCreateWorkspace && (
									<DropdownMenuItem onSelect={createWorkspace}>
										<Icon icon='plus' size='sm' />
										Novo workspace
									</DropdownMenuItem>
								)}
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuGroup>
						<DropdownMenuItem onSelect={() => navigate('/settings')}>Configurações</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => navigate('/usage')}>Uso</DropdownMenuItem>
						{me?.role === 'owner' && (
							<DropdownMenuItem onSelect={() => window.location.assign(githubInstallUrl(me.workspaceId))}>
								{me.hasInstallation ? 'Gerenciar acesso ao GitHub' : 'Conectar ao GitHub'}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onSelect={logout}>Sair</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

export { Profile };
