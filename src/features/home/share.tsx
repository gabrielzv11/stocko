import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copyButton';
import Dialog from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/** Link público só-leitura da conversa (perguntas e respostas, sem a saída bruta das tools). */
export function ShareButton({ conversationId }: { conversationId: string }) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const key = ['conversation', conversationId, 'share'];
	const share = useQuery({
		queryKey: key,
		queryFn: () =>
			api.get<{ token: string | null }>(`/conversations/${conversationId}/share`).then((r) => r.data.token),
		enabled: open,
	});
	const setToken = (token: string | null) => queryClient.setQueryData(key, token);
	const create = useMutation({
		mutationFn: () =>
			api.post<{ token: string }>(`/conversations/${conversationId}/share`).then((r) => r.data.token),
		onSuccess: setToken,
	});
	const revoke = useMutation({
		mutationFn: () => api.delete(`/conversations/${conversationId}/share`),
		onSuccess: () => setToken(null),
	});
	const url = share.data ? `${window.location.origin}/s/${share.data}` : null;

	return (
		<>
			<Button variant='ghost' size='sm' onClick={() => setOpen(true)}>
				<Icon icon='share' />
				Compartilhar chat
			</Button>
			<Dialog open={open} onClose={() => setOpen(false)} closeButton>
				<Dialog.Header>
					<Dialog.Title>Compartilhar conversa</Dialog.Title>
				</Dialog.Header>
				<Dialog.Body>
					<div className='flex flex-col gap-3 text-sm'>
						<p className='text-muted-foreground'>
							Qualquer pessoa com o link vê as perguntas e respostas desta conversa, inclusive trechos de
							código e citações, sem precisar entrar. As mensagens novas também aparecem. Revogar desativa o
							link.
						</p>
						{share.isPending && <p className='text-muted-foreground'>Carregando...</p>}
						{url && (
							<div className='border-border flex items-center gap-2 rounded-lg border p-2'>
								<span className='min-w-0 flex-1 truncate font-mono text-xs'>{url}</span>
								<CopyButton text={url} label='Copiar link' />
							</div>
						)}
						{(create.isError || revoke.isError) && (
							<p className='text-red-500'>Não foi possível atualizar o link.</p>
						)}
					</div>
				</Dialog.Body>
				<Dialog.Footer>
					<div className='flex gap-2'>
						{url ? (
							<Button
								variant='secondary'
								size='sm'
								loading={revoke.isPending}
								onClick={() => revoke.mutate()}
							>
								Revogar link
							</Button>
						) : (
							<Button
								size='sm'
								loading={create.isPending}
								disabled={share.isPending}
								onClick={() => create.mutate()}
							>
								Criar link
							</Button>
						)}
					</div>
				</Dialog.Footer>
			</Dialog>
		</>
	);
}
