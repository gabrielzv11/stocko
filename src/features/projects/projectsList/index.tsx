import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { List } from '@/components/ui/list';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { githubInstallUrl } from '@/lib/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useProjects, useRepos } from '../api';
import { ProjectApis } from '../projectApis';

interface Props extends React.HTMLAttributes<HTMLDivElement> {}

function ProjectsList({ ...props }: Props) {
	const [creating, setCreating] = useState(false);
	const [selectedId, setSelectedId] = useState<string>();
	const queryClient = useQueryClient();
	const { data: projects = [], isPending } = useProjects();
	const { data: repos = [], isPending: reposPending } = useRepos();
	const selected = projects.find((p) => p.id === selectedId);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects'] });

	const create = useMutation({
		mutationFn: (body: { name: string; repoIds: string[] }) => api.post('/projects', body),
		onSuccess: () => {
			setCreating(false);
			invalidate();
		},
	});
	const remove = useMutation({ mutationFn: (id: string) => api.delete(`/projects/${id}`), onSuccess: invalidate });

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const name = String(form.get('name')).trim();
		const repoIds = form.getAll('repoIds').map(String);
		if (name && repoIds.length) create.mutate({ name, repoIds });
	}

	return (
		<div {...props}>
			<div className='flex items-center justify-between gap-2 px-12 py-4'>
				<p className='text-muted-foreground text-sm'>{isPending ? 'Carregando projetos...' : `${projects.length} projeto(s)`}</p>
				{!creating && (
					<Button size='sm' onClick={() => setCreating(true)}>
						Novo projeto
					</Button>
				)}
			</div>

			{creating && (
				<form onSubmit={handleSubmit} className='flex flex-col gap-3 px-12 pb-4'>
					<TextField name='name' placeholder='Nome do projeto' required autoFocus />

					<fieldset className='border-border flex flex-col gap-1.5 rounded-lg border p-3'>
						<legend className='text-muted-foreground px-1 text-sm'>Repositórios</legend>
						{reposPending && <p className='text-muted-foreground text-sm'>Carregando repositórios...</p>}
						{!reposPending && !repos.length && <p className='text-muted-foreground text-sm'>Nenhum repositório liberado para o App.</p>}
						{repos.map((repo) => (
							<label key={repo.id} className='flex items-center gap-2 text-sm'>
								<input type='checkbox' name='repoIds' value={repo.id} />
								{repo.fullName}
							</label>
						))}
						<a href={githubInstallUrl} className='text-muted-foreground mt-1 text-xs underline'>
							Liberar outros repositórios no GitHub
						</a>
					</fieldset>

					{create.isError && <p className='text-sm text-red-500'>Não foi possível criar o projeto.</p>}

					<div className='flex gap-2'>
						<Button type='submit' size='sm' loading={create.isPending}>
							Criar
						</Button>
						<Button variant='secondary' size='sm' onClick={() => setCreating(false)}>
							Cancelar
						</Button>
					</div>
				</form>
			)}

			<List
				items={projects}
				onItemClick={(p) => setSelectedId(p.id)}
				renderItem={(project) => (
					<>
						<div className='min-w-0'>
							<h3 className='truncate text-xl font-semibold'>{project.name}</h3>
							<p className='text-muted-foreground truncate text-sm'>{project.repos.map((r) => r.fullName).join(', ')}</p>
						</div>
						<IconButton
							icon='trash-2'
							variant='ghost'
							color='destructive'
							size='sm'
							aria-label='Excluir projeto'
							disabled={remove.isPending}
							onClick={() => remove.mutate(project.id)}
						/>
					</>
				)}
			/>

			{selected && <ProjectApis key={selected.id} project={selected} />}
		</div>
	);
}

export { ProjectsList };
