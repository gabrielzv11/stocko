import { IconButton } from '@/components/ui/iconButton';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjects } from '../api';
import { ProjectApis } from '../projectApis';
import { ProjectRepos } from '../projectRepos';

export default function ProjectPage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const { data: projects = [], isPending } = useProjects();
	const project = projects.find((p) => p.id === id);

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
			</div>

			{project && <ProjectRepos project={project} />}
			{project && <ProjectApis project={project} />}
		</main>
	);
}
