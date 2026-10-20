import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdownMenu';
import { Icon } from '@/components/ui/icons';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQuery } from '@tanstack/react-query';

type Me = { id: string; name: string | null; avatarUrl: string | null; login: string | null; workspaceId: string };

async function logout() {
	await api.post('/auth/logout').catch(() => {});
	clearToken();
	window.location.assign('/login');
}

interface Props {
	collapsed?: boolean;
}

function Profile({ collapsed }: Props) {
	const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me').then((r) => r.data) });
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
							collapsed && 'justify-center px-0',
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

				<DropdownMenuContent side='top'>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Configurações</DropdownMenuLabel>
						<DropdownMenuItem onSelect={logout}>Sair</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

export { Profile };
