import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copyButton';
import { IconButton } from '@/components/ui/iconButton';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';

type ApiKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Chaves do usuário para o servidor MCP (/mcp), presas ao workspace ativo. A chave só aparece uma vez, ao criar. */
export function ApiKeysSection() {
	const queryClient = useQueryClient();
	const { data } = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<ApiKey[]>('/api-keys').then((r) => r.data) });
	const [created, setCreated] = useState<string | null>(null);
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['api-keys'] });

	const create = useMutation({
		mutationFn: (name: string) => api.post<{ key: string }>('/api-keys', { name }).then((r) => r.data),
		onSuccess: ({ key }) => {
			setCreated(key);
			invalidate();
		},
	});
	const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/api-keys/${id}`), onSuccess: invalidate });

	const error = [create.error, revoke.error].find(isAxiosError)?.response?.data?.message;
	const mcpUrl = `${import.meta.env.VITE_API_URL}/mcp`;

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const name = String(new FormData(form).get('name')).trim();
		if (name) create.mutate(name, { onSuccess: () => form.reset() });
	}

	return (
		<section className='flex flex-col gap-3'>
			<h2 className='text-base font-semibold'>Chaves de API (MCP)</h2>
			<p className='text-muted-foreground text-sm'>
				Agentes externos (Claude Code, Cursor, CI) consultam os projetos deste workspace em <span className='font-mono'>{mcpUrl}</span> com{' '}
				<span className='font-mono'>Authorization: Bearer &lt;chave&gt;</span>. A chave age como você, só neste workspace, e para de valer se
				você sair dele.
			</p>

			{created && (
				<div className='border-primary bg-card flex flex-col gap-2 rounded-2xl border p-4'>
					<p className='text-sm'>Copie a chave agora: ela não será exibida de novo.</p>
					<div className='flex items-center gap-2'>
						<code className='min-w-0 flex-1 truncate text-sm'>{created}</code>
						<CopyButton text={created} label='Copiar chave' />
						<IconButton icon='x' variant='ghost' size='sm' aria-label='Fechar' onClick={() => setCreated(null)} />
					</div>
				</div>
			)}

			{data?.map((k) => (
				<div key={k.id} className='flex items-center gap-3'>
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm'>{k.name}</p>
						<p className='text-muted-foreground text-xs'>
							<span className='font-mono'>{k.prefix}…</span> · criada em {date(k.createdAt)} ·{' '}
							{k.lastUsedAt ? `último uso em ${date(k.lastUsedAt)}` : 'nunca usada'}
						</p>
					</div>
					<IconButton
						icon='trash'
						variant='ghost'
						color='destructive'
						size='sm'
						aria-label={`Revogar ${k.name}`}
						disabled={revoke.isPending}
						onClick={() => revoke.mutate(k.id)}
					/>
				</div>
			))}

			<form onSubmit={handleSubmit} className='flex gap-2'>
				<TextField name='name' size='sm' placeholder='Nome da chave, ex.: notebook, CI' maxLength={60} required />
				<Button type='submit' size='sm' variant='secondary' loading={create.isPending} className='w-auto px-6'>
					Gerar chave
				</Button>
			</form>
			{error && <p className='text-sm text-red-500'>{error}</p>}
		</section>
	);
}
