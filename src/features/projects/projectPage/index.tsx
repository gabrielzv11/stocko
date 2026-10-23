import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjects } from '../api';
import { ProjectApis } from '../projectApis';
import { ProjectDialog } from '../projectDialog';
import { ProjectRepos } from '../projectRepos';

export default function ProjectPage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);
	const queryClient = useQueryClient();
	const { data: projects = [], isPending } = useProjects();
	const project = projects.find((p) => p.id === id);

	const update = useMutation({
		mutationFn: (body: { name: string; repoIds: string[] }) => api.patch(`/projects/${id}`, body),
		onSuccess: () => {
			setEditing(false);
			queryClient.invalidateQueries({ queryKey: ['projects'] });
		},
	});

	return (
		<main>
			<div className='flex items-center gap-3 px-12 py-4'>
				<IconButton icon='arrow-left' variant='secondary' size='sm' aria-label='Voltar para projetos' onClick={() => navigate('/projects')} />
				<div className='min-w-0'>
					{isPending && <p className='text-muted-foreground text-sm'>Carregando projeto...</p>}
					{!isPending && !project && <p className='text-muted-foreground text-sm'>Projeto não encontrado.</p>}
					{project && (
						<>
							<h2 className='truncate text-2xl font-semibold'>{project.name}</h2>
							<p className='text-muted-foreground truncate text-sm'>{project.repos.map((r) => r.fullName).join(', ')}</p>
						</>
					)}
				</div>
				{project && (
					<Button variant='secondary' size='sm' className='ml-auto' onClick={() => setEditing(true)}>
						Editar
					</Button>
				)}
			</div>

			{project && (
				<ProjectDialog
					open={editing}
					onClose={() => setEditing(false)}
					title='Editar projeto'
					submitLabel='Salvar'
					project={project}
					onSubmit={(body) => update.mutate(body)}
					pending={update.isPending}
					error={update.isError ? 'Não foi possível salvar o projeto.' : undefined}
				/>
			)}
			{project && <ProjectRepos project={project} />}
			{project && <ProjectApis project={project} />}
		</main>
	);
}
