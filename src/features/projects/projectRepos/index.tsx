import { Button } from '@/components/ui/button';
import { CircularProgress } from '@/components/ui/circularProgress';
import { Icon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/iconButton';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useRemoteBranches, type Branch, type Project, type ProjectRepo } from '../api';

const MAX_BRANCHES = 5;

function BranchStatus({ branch }: { branch: Branch }) {
	if (branch.status === 'error') return <span className='truncate text-xs text-red-500'>{branch.error ?? 'Erro no sync'}</span>;
	if (branch.status !== 'ready')
		return (
			<span className='text-muted-foreground flex items-center gap-1 text-xs'>
				<CircularProgress className='size-3' /> Sincronizando
			</span>
		);
	return <span className='text-muted-foreground font-mono text-xs'>{branch.lastSyncedSha?.slice(0, 7)}</span>;
}

/** Branches observadas de um repo, em ordem de prioridade (cascata do agente). */
function RepoBranches({ repo }: { repo: ProjectRepo }) {
	const [adding, setAdding] = useState(false);
	const queryClient = useQueryClient();
	const remote = useRemoteBranches(repo.repositoryId, adding);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects'] });
	const base = `/repositories/${repo.repositoryId}`;

	const add = useMutation({
		mutationFn: (name: string) => api.post(`${base}/branches`, { name }),
		onSuccess: () => {
			setAdding(false);
			invalidate();
		},
	});
	const remove = useMutation({ mutationFn: (id: string) => api.delete(`${base}/branches/${id}`), onSuccess: invalidate });
	const reorder = useMutation({ mutationFn: (ids: string[]) => api.put(`${base}/branches/order`, { ids }), onSuccess: invalidate });
	const sync = useMutation({ mutationFn: () => api.post(`${base}/sync`), onSuccess: invalidate });

	function move(from: number, to: number) {
		const ids = repo.branches.map((b) => b.id);
		[ids[from], ids[to]] = [ids[to], ids[from]];
		reorder.mutate(ids);
	}

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const name = String(new FormData(e.currentTarget).get('branch')).trim();
		if (name) add.mutate(name);
	}

	const observed = new Set(repo.branches.map((b) => b.name));
	const listId = `branches-${repo.repositoryId}`;
	const error = [add.error, remove.error, reorder.error].find(isAxiosError)?.response?.data?.message;

	return (
		<div className='border-border flex flex-col gap-2 border-b py-3'>
			<div className='flex items-center justify-between gap-2'>
				<p className='truncate font-medium'>{repo.fullName}</p>
				<div className='flex gap-1'>
					<IconButton
						icon='refresh-cw'
						variant='ghost'
						size='sm'
						aria-label='Sincronizar agora'
						disabled={sync.isPending}
						onClick={() => sync.mutate()}
					/>
					{repo.branches.length < MAX_BRANCHES && (
						<Button variant='secondary' size='sm' onClick={() => setAdding((a) => !a)}>
							Observar branch
						</Button>
					)}
				</div>
			</div>

			{adding && (
				<form onSubmit={handleSubmit} className='flex gap-2'>
					<TextField
						name='branch'
						size='sm'
						list={listId}
						placeholder={remote.isPending ? 'Carregando branches...' : 'Nome da branch'}
						autoFocus
						required
					/>
					<datalist id={listId}>
						{remote.data
							?.filter((n) => !observed.has(n))
							.map((n) => (
								<option key={n} value={n} />
							))}
					</datalist>
					<Button type='submit' size='sm' loading={add.isPending}>
						Adicionar
					</Button>
				</form>
			)}

			<ol className='flex flex-col gap-1'>
				{repo.branches.map((b, i) => (
					<li key={b.id} className='flex items-center gap-2'>
						<span className='text-muted-foreground w-4 text-xs'>{i + 1}</span>
						<Icon icon='git-branch' size='xs' className='text-muted-foreground shrink-0' />
						<span className='truncate text-sm'>{b.name}</span>
						{i === 0 && <span className='text-muted-foreground text-xs'>(padrão)</span>}
						<BranchStatus branch={b} />
						<div className='ml-auto flex gap-1'>
							<IconButton
								icon='arrow-up'
								variant='ghost'
								size='sm'
								aria-label={`Subir ${b.name}`}
								disabled={i === 0 || reorder.isPending}
								onClick={() => move(i, i - 1)}
							/>
							<IconButton
								icon='arrow-down'
								variant='ghost'
								size='sm'
								aria-label={`Descer ${b.name}`}
								disabled={i === repo.branches.length - 1 || reorder.isPending}
								onClick={() => move(i, i + 1)}
							/>
							<IconButton
								icon='trash-2'
								variant='ghost'
								color='destructive'
								size='sm'
								aria-label={`Parar de observar ${b.name}`}
								disabled={repo.branches.length === 1 || remove.isPending}
								onClick={() => remove.mutate(b.id)}
							/>
						</div>
					</li>
				))}
			</ol>

			{error && <p className='text-sm text-red-500'>{error}</p>}
		</div>
	);
}

function ProjectRepos({ project }: { project: Project }) {
	return (
		<section className='flex flex-col gap-1 px-12 py-4'>
			<h3 className='text-lg font-semibold'>Repositórios</h3>
			<p className='text-muted-foreground text-sm'>
				Até {MAX_BRANCHES} branches por repositório. A primeira é o que está no ar; o agente procura nas seguintes, em ordem, o que não achar
				nela.
			</p>
			{project.repos.map((r) => (
				<RepoBranches key={r.repositoryId} repo={r} />
			))}
		</section>
	);
}

export { ProjectRepos };
