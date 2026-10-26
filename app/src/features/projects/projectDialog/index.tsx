import { Button } from '@/components/ui/button';
import { CheckboxComposeItem } from '@/components/ui/checkboxCompose';
import Dialog from '@/components/ui/dialog';
import { TextField } from '@/components/ui/textField';
import { githubInstallUrl } from '@/lib/auth';
import { useMe } from '@/lib/me';
import { useState } from 'react';
import { useRepos, type Project } from '../api';

/** Letras do termo aparecem em ordem no texto, não necessariamente juntas ('crivo-app' acha 'crivoai-app'). */
export function fuzzyMatch(text: string, term: string) {
	let i = 0;
	for (const ch of text.toLowerCase()) if (ch === term[i]) i++;
	return i === term.length;
}

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	submitLabel: string;
	/** Edição: nome e repos já marcados. */
	project?: Project;
	onSubmit: (body: { name: string; repoIds: string[] }) => void;
	pending: boolean;
	error?: string;
}

/** Nome + repositórios do projeto; usado para criar e para editar. */
function ProjectDialog({ open, onClose, title, submitLabel, project, onSubmit, pending, error }: Props) {
	const [repoSearch, setRepoSearch] = useState('');
	const { data: repos = [], isPending: reposPending } = useRepos();
	const { data: me } = useMe();
	const repoTerm = repoSearch.trim().toLowerCase();
	const selected = new Set(project?.repos.map((r) => r.id));

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const name = String(form.get('name')).trim();
		const repoIds = form.getAll('repoIds').map(String);
		if (name && repoIds.length) onSubmit({ name, repoIds });
	}

	return (
		<Dialog open={open} onClose={onClose} closeButton>
			{/* key: reabrir com outro projeto recomeça os valores iniciais */}
			<form key={project?.id} onSubmit={handleSubmit}>
				<Dialog.Header>
					<Dialog.Title>{title}</Dialog.Title>
				</Dialog.Header>

				<Dialog.Body>
					<div className='flex flex-col gap-3'>
						<TextField name='name' placeholder='Nome do projeto' defaultValue={project?.name} required autoFocus />

						<p className='text-muted-foreground text-sm'>Repositórios</p>
						{reposPending && <p className='text-muted-foreground text-sm'>Carregando repositórios...</p>}
						{!reposPending && !repos.length && <p className='text-muted-foreground text-sm'>Nenhum repositório liberado para o App.</p>}
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
										defaultChecked={selected.has(repo.id)}
									/>
								</div>
							))}
						</div>
						{me?.role === 'owner' && me.workspaceId && (
							<a href={githubInstallUrl(me.workspaceId)} className='text-muted-foreground text-xs underline'>
								Liberar outros repositórios no GitHub
							</a>
						)}

						{error && <p className='text-sm text-red-500'>{error}</p>}
					</div>
				</Dialog.Body>

				<Dialog.Footer>
					<div className='flex gap-2'>
						<Button variant='secondary' size='sm' onClick={onClose}>
							Cancelar
						</Button>
						<Button type='submit' size='sm' loading={pending}>
							{submitLabel}
						</Button>
					</div>
				</Dialog.Footer>
			</form>
		</Dialog>
	);
}

export { ProjectDialog };
