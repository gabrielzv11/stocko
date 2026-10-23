import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useProjectApis, type Project } from '../api';

const textarea = 'min-h-20 rounded-lg border border-border bg-transparent p-2 text-sm';

/** Specs OpenAPI/Swagger que o agente consulta (e chama via GET, se tiver URL base). */
function ProjectApis({ project }: { project: Project }) {
	const [adding, setAdding] = useState(false);
	const queryClient = useQueryClient();
	const { data: apis = [], isPending } = useProjectApis(project.id);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'apis'] });

	const create = useMutation({
		mutationFn: (body: Record<string, string>) => api.post(`/projects/${project.id}/apis`, body),
		onSuccess: () => {
			setAdding(false);
			invalidate();
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => api.delete(`/projects/${project.id}/apis/${id}`),
		onSuccess: invalidate,
	});

	async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const file = form.get('specFile');
		const spec = file instanceof File && file.size ? await file.text() : String(form.get('specText') ?? '');
		// Campos opcionais vazios não vão no corpo.
		const body = Object.fromEntries(
			['title', 'description', 'usage', 'baseUrl', 'authHeader'].map((k) => [k, String(form.get(k) ?? '').trim()]).filter(([, v]) => v),
		);
		if (spec.trim()) create.mutate({ ...body, spec });
	}

	const error = isAxiosError(create.error) ? (create.error.response?.data?.message ?? 'Dados inválidos.') : null;

	return (
		<section className='flex flex-col gap-3 px-12 py-4'>
			<div className='flex items-center justify-between gap-2'>
				<h3 className='text-lg font-semibold'>APIs</h3>
				{!adding && (
					<Button size='sm' onClick={() => setAdding(true)}>
						Adicionar API
					</Button>
				)}
			</div>

			{adding && (
				<form onSubmit={handleSubmit} className='flex flex-col gap-3'>
					<TextField name='title' placeholder='Título (ex.: Prometheus produção)' required autoFocus />
					<textarea name='description' className={textarea} placeholder='Descrição: o que é esta API' required />
					<textarea
						name='usage'
						className={textarea}
						placeholder='Forma de uso: quando e como o agente deve consultar (ex.: lentidão → /api/v1/query com histogram_quantile)'
					/>
					<TextField name='baseUrl' type='url' placeholder='URL base para chamadas GET (vazio = só documentação)' />
					<TextField name='authHeader' placeholder='Header de auth (ex.: Authorization: Bearer xxx), salvo criptografado' />
					<label className='text-muted-foreground flex flex-col gap-1 text-sm'>
						Spec OpenAPI/Swagger (.json, .yaml)
						<input type='file' name='specFile' accept='.json,.yaml,.yml' />
					</label>
					<textarea name='specText' className={`${textarea} font-mono`} placeholder='...ou cole a spec aqui' />

					{create.isError && <p className='text-sm text-red-500'>{error}</p>}

					<div className='flex gap-2'>
						<Button type='submit' size='sm' loading={create.isPending}>
							Salvar
						</Button>
						<Button variant='secondary' size='sm' onClick={() => setAdding(false)}>
							Cancelar
						</Button>
					</div>
				</form>
			)}

			{isPending && <p className='text-muted-foreground text-sm'>Carregando APIs...</p>}
			{!isPending && !apis.length && !adding && (
				<p className='text-muted-foreground text-sm'>Nenhuma API. Adicione specs de serviços ou do monitoramento.</p>
			)}
			{apis.map((a) => (
				<div key={a.id} className='border-border flex justify-between gap-4 border-b py-2'>
					<div className='min-w-0'>
						<p className='truncate font-medium'>{a.title}</p>
						<p className='text-muted-foreground truncate text-sm'>{a.description}</p>
						<p className='text-muted-foreground truncate text-xs'>
							{a.baseUrl ? `${a.baseUrl}${a.hasAuth ? ' · com auth' : ''}` : 'Só documentação'}
						</p>
					</div>
					<IconButton
						icon='trash-2'
						variant='ghost'
						color='destructive'
						size='sm'
						aria-label='Remover API'
						disabled={remove.isPending}
						onClick={() => remove.mutate(a.id)}
					/>
				</div>
			))}
		</section>
	);
}

export { ProjectApis };
