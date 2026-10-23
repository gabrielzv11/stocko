import { Button } from '@/components/ui/button';
import { CircularProgress } from '@/components/ui/circularProgress';
import Dialog from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/iconButton';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { day } from '@/lib/dayjs';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useKnowledge, type KnowledgeSource, type Project } from '../api';

const textarea = 'min-h-20 rounded-lg border border-border bg-transparent p-2 text-sm';

function SourceStatus({ source }: { source: KnowledgeSource }) {
	if (source.status === 'error') return <span className='truncate text-xs text-red-500'>{source.error ?? 'Erro no sync'}</span>;
	if (source.status === 'syncing')
		return (
			<span className='text-muted-foreground flex items-center gap-1 text-xs'>
				<CircularProgress className='size-3' /> Sincronizando
			</span>
		);
	return (
		<span className='text-muted-foreground text-xs'>
			{source.type === 'jira' ? `${source.chunks} issue(s)` : `${source.chunks} trecho(s)`}
			{source.type === 'jira' && source.syncedAt && ` · sincronizado ${day(source.syncedAt).format('DD/MM HH:mm')}`}
		</span>
	);
}

/** Docs e consultas do Jira do projeto: o que o código deveria fazer, para o agente comparar com o que faz. */
function ProjectKnowledge({ project }: { project: Project }) {
	const [adding, setAdding] = useState<'doc' | 'jira' | null>(null);
	const queryClient = useQueryClient();
	const { data: sources = [], isPending } = useKnowledge(project.id);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'knowledge'] });

	const create = useMutation({
		mutationFn: ({ type, body }: { type: 'doc' | 'jira'; body: Record<string, string> }) =>
			api.post(`/projects/${project.id}/${type === 'doc' ? 'docs' : 'jira'}`, body),
		onSuccess: () => {
			setAdding(null);
			invalidate();
		},
	});
	const remove = useMutation({ mutationFn: (id: string) => api.delete(`/projects/${project.id}/sources/${id}`), onSuccess: invalidate });
	const sync = useMutation({ mutationFn: (id: string) => api.post(`/sources/${id}/sync`), onSuccess: invalidate });

	async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const field = (k: string) => String(form.get(k) ?? '').trim();
		if (adding === 'jira')
			return create.mutate({
				type: 'jira',
				body: { baseUrl: field('baseUrl'), email: field('email'), token: field('token'), jql: field('jql') },
			});
		const file = form.get('file');
		const content = file instanceof File && file.size ? await file.text() : field('content');
		const title = field('title') || (file instanceof File ? file.name.replace(/\.\w+$/, '') : '');
		if (content) create.mutate({ type: 'doc', body: { title, content } });
	}

	const error = isAxiosError(create.error) ? (create.error.response?.data?.message ?? 'Dados inválidos.') : null;

	return (
		<section className='flex flex-col gap-3 px-12 py-4'>
			<div className='flex items-center justify-between gap-2'>
				<h3 className='text-lg font-semibold'>Docs e Jira</h3>
				<div className='flex gap-2'>
					<Button variant='secondary' size='sm' onClick={() => setAdding('doc')}>
						Adicionar doc
					</Button>
					<Button variant='secondary' size='sm' onClick={() => setAdding('jira')}>
						Conectar Jira
					</Button>
				</div>
			</div>
			<p className='text-muted-foreground text-sm'>
				Requisitos, regras e tickets dizem o que deveria ser; o agente compara com o código e aponta divergências.
			</p>

			<Dialog open={!!adding} onClose={() => setAdding(null)} closeButton>
				{/* key: trocar de doc para Jira limpa o formulário */}
				<form key={adding} onSubmit={handleSubmit}>
					<Dialog.Header>
						<Dialog.Title>{adding === 'jira' ? 'Conectar Jira' : 'Novo doc'}</Dialog.Title>
					</Dialog.Header>
					<Dialog.Body>
						<div className='flex flex-col gap-3'>
							{adding === 'jira' ? (
								<>
									<TextField name='baseUrl' type='url' placeholder='https://empresa.atlassian.net' required autoFocus />
									<TextField name='email' type='email' placeholder='E-mail da conta Atlassian' required />
									<TextField
										name='token'
										type='password'
										autoComplete='off'
										placeholder='API token (id.atlassian.com → Segurança)'
										helperText='Salvo criptografado; nunca é exibido de volta.'
										required
									/>
									<textarea
										name='jql'
										className={`${textarea} font-mono`}
										placeholder='JQL, ex.: project = PAG AND updated >= -180d'
										required
									/>
								</>
							) : (
								<>
									<TextField name='title' placeholder='Título (vazio = nome do arquivo)' autoFocus />
									<label className='text-muted-foreground flex flex-col gap-1 text-sm'>
										Arquivo (.md, .txt)
										<input type='file' name='file' accept='.md,.markdown,.txt' />
									</label>
									<textarea name='content' className={textarea} placeholder='...ou cole o texto aqui' />
								</>
							)}
							{create.isError && <p className='text-sm text-red-500'>{error}</p>}
						</div>
					</Dialog.Body>
					<Dialog.Footer>
						<div className='flex gap-2'>
							<Button variant='secondary' size='sm' onClick={() => setAdding(null)}>
								Cancelar
							</Button>
							<Button type='submit' size='sm' loading={create.isPending}>
								Salvar
							</Button>
						</div>
					</Dialog.Footer>
				</form>
			</Dialog>

			{isPending && <p className='text-muted-foreground text-sm'>Carregando...</p>}
			{!isPending && !sources.length && <p className='text-muted-foreground text-sm'>Nenhum doc ou Jira conectado.</p>}
			{sources.map((s) => (
				<div key={s.id} className='border-border flex items-center justify-between gap-4 border-b py-2'>
					<div className='flex min-w-0 items-center gap-2'>
						<Icon icon={s.type === 'jira' ? 'ticket' : 'file-text'} size='sm' className='text-muted-foreground shrink-0' />
						<div className='min-w-0'>
							<p className='truncate font-medium'>{s.type === 'jira' ? `Jira: ${s.title}` : s.title}</p>
							<SourceStatus source={s} />
						</div>
					</div>
					<div className='flex shrink-0 gap-1'>
						{s.type === 'jira' && (
							<IconButton
								icon='refresh-cw'
								variant='ghost'
								size='sm'
								aria-label='Sincronizar agora'
								disabled={s.status === 'syncing' || sync.isPending}
								onClick={() => sync.mutate(s.id)}
							/>
						)}
						<IconButton
							icon='trash-2'
							variant='ghost'
							color='destructive'
							size='sm'
							aria-label={`Remover ${s.title}`}
							disabled={remove.isPending}
							onClick={() => remove.mutate(s.id)}
						/>
					</div>
				</div>
			))}
		</section>
	);
}

export { ProjectKnowledge };
