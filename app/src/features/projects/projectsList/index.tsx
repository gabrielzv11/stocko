import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { List } from '@/components/ui/list';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../api';
import { fuzzyMatch, ProjectDialog } from '../projectDialog';

interface Props extends React.HTMLAttributes<HTMLDivElement> {}

function ProjectsList({ ...props }: Props) {
	const [creating, setCreating] = useState(false);
	const [search, setSearch] = useState('');
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: projects = [], isPending } = useProjects();
	const owner = useMe().data?.role === 'owner';
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects'] });

	const term = search.trim().toLowerCase();
	const filtered = term
		? projects.filter((p) =>
				[p.name, ...p.repos.map((r) => r.fullName)].some((s) => fuzzyMatch(s, term))
			)
		: projects;

	const create = useMutation({
		mutationFn: (body: { name: string; repoIds: string[] }) => api.post('/projects', body),
		onSuccess: () => {
			setCreating(false);
			invalidate();
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => api.delete(`/projects/${id}`),
		onSuccess: invalidate,
	});

	return (
		<div {...props}>
			<div className='flex items-center justify-between gap-2   py-4'>
				<p className='text-muted-foreground text-sm'>
					{isPending ? 'Carregando projetos...' : `${projects.length} projeto(s)`}
				</p>
				<Button size='sm' onClick={() => setCreating(true)}>
					Novo projeto
				</Button>
			</div>

			<ProjectDialog
				open={creating}
				onClose={() => setCreating(false)}
				title='Novo projeto'
				submitLabel='Criar'
				onSubmit={(body) => create.mutate(body)}
				pending={create.isPending}
				error={create.isError ? 'Não foi possível criar o projeto.' : undefined}
			/>

			<div className='  pb-4'>
				<TextField
					name='search'
					type='search'
					size='sm'
					placeholder='Buscar por projeto ou repositório'
					ornament='search'
					ornamentPosition='left'
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>

			<List
				items={filtered}
				onItemClick={(p) => navigate(p.id)}
				renderItem={(project) => (
					<>
						<div className='min-w-0'>
							<h3 className='truncate text-xl font-semibold'>{project.name}</h3>
							<p className='text-muted-foreground truncate text-sm'>
								{project.repos.map((r) => r.fullName).join(', ')}
							</p>
						</div>
						{owner && (
							<IconButton
								icon='trash-2'
								variant='ghost'
								color='destructive'
								size='sm'
								aria-label='Excluir projeto'
								disabled={remove.isPending}
								onClick={(e) => {
									e.stopPropagation();
									remove.mutate(project.id);
								}}
							/>
						)}
					</>
				)}
			/>
		</div>
	);
}

export { ProjectsList };
