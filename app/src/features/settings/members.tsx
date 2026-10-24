import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMe, type Role } from '@/lib/me';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

type Members = {
	members: { userId: string; name: string | null; avatarUrl: string | null; login: string | null; role: Role }[];
	invites: { id: string; login: string; createdAt: string }[];
};

/** Membros do workspace ativo; o dono convida por login do GitHub (entra no próximo login da pessoa). */
export function MembersSection() {
	const queryClient = useQueryClient();
	const { data: me } = useMe();
	const { data } = useQuery({ queryKey: ['members'], queryFn: () => api.get<Members>('/members').then((r) => r.data) });
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['members'] });
	const owner = me?.role === 'owner';

	const invite = useMutation({ mutationFn: (login: string) => api.post('/invites', { login }), onSuccess: invalidate });
	const cancel = useMutation({ mutationFn: (id: string) => api.delete(`/invites/${id}`), onSuccess: invalidate });
	const remove = useMutation({ mutationFn: (userId: string) => api.delete(`/members/${userId}`), onSuccess: invalidate });

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const login = String(new FormData(form).get('login')).trim().replace(/^@/, '');
		if (login) invite.mutate(login, { onSuccess: () => form.reset() });
	}

	const error = [invite.error, cancel.error, remove.error].find(isAxiosError)?.response?.data?.message;

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-base font-semibold'>Membros</h2>
			<p className='text-muted-foreground text-sm'>
				Todos veem os mesmos projetos, conversas e configurações. A pessoa convidada entra no workspace no próximo login com o GitHub.
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

			{data?.invites.map((i) => (
				<div key={i.id} className='flex items-center gap-3'>
					<span className='border-border size-8 rounded-full border border-dashed' />
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm'>@{i.login}</p>
						<p className='text-muted-foreground text-xs'>Convite pendente</p>
					</div>
					{owner && (
						<IconButton
							icon='x'
							variant='ghost'
							size='sm'
							aria-label={`Cancelar convite de ${i.login}`}
							disabled={cancel.isPending}
							onClick={() => cancel.mutate(i.id)}
						/>
					)}
				</div>
			))}

			{owner && (
				<form onSubmit={handleSubmit} className='flex gap-2'>
					<TextField name='login' size='sm' placeholder='Login do GitHub' autoComplete='off' required />
					<Button type='submit' size='sm' loading={invite.isPending} className='w-auto px-6'>
						Convidar
					</Button>
				</form>
			)}
			{error && <p className='text-sm text-red-500'>{error}</p>}
		</section>
	);
}
