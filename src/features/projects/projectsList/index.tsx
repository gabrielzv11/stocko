import { Button } from '@/components/ui/button';
import { CheckboxComposeItem } from '@/components/ui/checkboxCompose';
import Dialog from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/iconButton';
import { List } from '@/components/ui/list';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { githubInstallUrl } from '@/lib/auth';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects, useRepos } from '../api';

interface Props extends React.HTMLAttributes<HTMLDivElement> {}

/** Letras do termo aparecem em ordem no texto, não necessariamente juntas ('crivo-app' acha 'crivoai-app'). */
function fuzzyMatch(text: string, term: string) {
	let i = 0;
	for (const ch of text.toLowerCase()) if (ch === term[i]) i++;
	return i === term.length;
}

function ProjectsList({ ...props }: Props) {
	const [creating, setCreating] = useState(false);
	const [search, setSearch] = useState('');
	const [repoSearch, setRepoSearch] = useState('');
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: projects = [], isPending } = useProjects();
	const { data: repos = [], isPending: reposPending } = useRepos();
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects'] });

	const term = search.trim().toLowerCase();
	const filtered = term
		? projects.filter((p) =>
				[p.name, ...p.repos.map((r) => r.fullName)].some((s) => fuzzyMatch(s, term))
			)
		: projects;
	const repoTerm = repoSearch.trim().toLowerCase();

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

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const name = String(form.get('name')).trim();
		const repoIds = form.getAll('repoIds').map(String);
		if (name && repoIds.length) create.mutate({ name, repoIds });
	}

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

			<Dialog open={creating} onClose={() => setCreating(false)} closeButton>
				<form onSubmit={handleSubmit}>
					<Dialog.Header>
						<Dialog.Title>Novo projeto</Dialog.Title>
					</Dialog.Header>

					<Dialog.Body>
						<div className='flex flex-col gap-3'>
							<TextField name='name' placeholder='Nome do projeto' required autoFocus />

							<p className='text-muted-foreground text-sm'>Repositórios</p>
							{reposPending && <p className='text-muted-foreground text-sm'>Carregando repositórios...</p>}
							{!reposPending && !repos.length && (
								<p className='text-muted-foreground text-sm'>Nenhum repositório liberado para o App.</p>
							)}
							{!!repos.length && (
								<TextField
									type='search'
									size='sm'
									name='repoSearch'
									placeholder='Buscar repositório'
									ornament='search'
									ornamentPosition='left'
									value={repoSearch}
									onChange={(e) => setRepoSearch(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
								/>
							)}
							<div className='flex max-h-[50vh] flex-col gap-2 overflow-y-auto'>
								{/* hidden em vez de filtrar: mantém marcados fora da busca no form */}
								{repos.map((repo) => (
									<div key={repo.id} hidden={!!repoTerm && !fuzzyMatch(repo.fullName, repoTerm)}>
										<CheckboxComposeItem
											name='repoIds'
											value={repo.id}
											title={repo.fullName}
											description={repo.private ? 'Privado' : 'Público'}
										/>
									</div>
								))}
							</div>
							<a href={githubInstallUrl} className='text-muted-foreground text-xs underline'>
								Liberar outros repositórios no GitHub
							</a>

							{create.isError && <p className='text-sm text-red-500'>Não foi possível criar o projeto.</p>}
						</div>
					</Dialog.Body>

					<Dialog.Footer>
						<div className='flex gap-2'>
							<Button variant='secondary' size='sm' onClick={() => setCreating(false)}>
								Cancelar
							</Button>
							<Button type='submit' size='sm' loading={create.isPending}>
								Criar
							</Button>
						</div>
					</Dialog.Footer>
				</form>
			</Dialog>

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
					</>
				)}
			/>
		</div>
	);
}

export { ProjectsList };
