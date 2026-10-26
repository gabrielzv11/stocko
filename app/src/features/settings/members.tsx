import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copyButton';
import { IconButton } from '@/components/ui/iconButton';
import { api } from '@/lib/api';
import { useMe, type Role } from '@/lib/me';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

type Members = {
	members: { userId: string; name: string | null; avatarUrl: string | null; login: string | null; role: Role }[];
	invites: { id: string; code: string; expiresAt: string }[];
};

/** Membros do workspace ativo; o dono gera links de convite (valem 7 dias para quantas pessoas tiverem o link). */
export function MembersSection() {
	const queryClient = useQueryClient();
	const { data: me } = useMe();
	const { data } = useQuery({ queryKey: ['members'], queryFn: () => api.get<Members>('/members').then((r) => r.data) });
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['members'] });
	const owner = me?.role === 'owner';

	const invite = useMutation({ mutationFn: () => api.post('/invites'), onSuccess: invalidate });
	const cancel = useMutation({ mutationFn: (id: string) => api.delete(`/invites/${id}`), onSuccess: invalidate });
	const remove = useMutation({ mutationFn: (userId: string) => api.delete(`/members/${userId}`), onSuccess: invalidate });

	const error = [invite.error, cancel.error, remove.error].find(isAxiosError)?.response?.data?.message;

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-base font-semibold'>Membros</h2>
			<p className='text-muted-foreground text-sm'>
				Todos veem os mesmos projetos, conversas e configurações. Quem abrir um link de convite ativo entra como membro.
			</p>

			{data?.members.map((m) => (
				<div key={m.userId} className='flex items-center gap-3'>
					{m.avatarUrl ? (
						<img src={m.avatarUrl} alt='' className='size-8 rounded-full' />
					) : (
						<span className='bg-card size-8 rounded-full' />
					)}
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm'>{m.name ?? m.login}</p>
						<p className='text-muted-foreground text-xs'>
							{m.login && `@${m.login} · `}
							{m.role === 'owner' ? 'Dono' : 'Membro'}
						</p>
					</div>
					{owner && m.role === 'member' && (
						<IconButton
							icon='user-minus'
							variant='ghost'
							color='destructive'
							size='sm'
							aria-label={`Remover ${m.login ?? m.name}`}
							disabled={remove.isPending}
							onClick={() => remove.mutate(m.userId)}
						/>
					)}
				</div>
			))}

			{data?.invites.map((i) => {
				const link = `${window.location.origin}/invite/${i.code}`;
				return (
					<div key={i.id} className='flex items-center gap-3'>
						<span className='border-border size-8 rounded-full border border-dashed' />
						<div className='min-w-0 flex-1'>
							<p className='truncate font-mono text-sm'>{link}</p>
							<p className='text-muted-foreground text-xs'>
								Código {i.code} · válido até {new Date(i.expiresAt).toLocaleDateString('pt-BR')}
							</p>
						</div>
						<CopyButton text={link} label='Copiar link' />
						<IconButton
							icon='x'
							variant='ghost'
							size='sm'
							aria-label='Revogar convite'
							disabled={cancel.isPending}
							onClick={() => cancel.mutate(i.id)}
						/>
					</div>
				);
			})}

			{owner && (
				<div>
					<Button size='sm' variant='secondary' loading={invite.isPending} onClick={() => invite.mutate()} className='w-auto px-6'>
						Gerar link de convite
					</Button>
				</div>
			)}
			{error && <p className='text-sm text-red-500'>{error}</p>}
		</section>
	);
}
