import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/contextMenu';
import Dialog from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ConversationSummary } from './api';

interface Props {
	conversation: ConversationSummary;
	/** Área que abre o menu com o botão direito; precisa repassar ref e props (ex.: uma div). */
	children: React.ReactElement;
}

/** Fixar e renomear a conversa. */
export function ConversationMenu({ conversation, children }: Props) {
	const [renaming, setRenaming] = useState(false);
	const queryClient = useQueryClient();
	const update = useMutation({
		mutationFn: (data: { title?: string; pinned?: boolean }) => api.patch(`/conversations/${conversation.id}`, data),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
		onError: () => toast.error('Não foi possível atualizar a conversa.'),
	});

	function rename(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const title = String(new FormData(e.currentTarget).get('title') ?? '').trim();
		if (!title || title === conversation.title) return setRenaming(false);
		update.mutate({ title }, { onSuccess: () => setRenaming(false) });
	}

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				{/* Ao fechar, o menu devolveria o foco e o tiraria do campo do diálogo. */}
				<ContextMenuContent onCloseAutoFocus={(e) => renaming && e.preventDefault()}>
					<ContextMenuItem onSelect={() => update.mutate({ pinned: !conversation.pinned })}>
						<Icon icon={conversation.pinned ? 'pin-off' : 'pin'} />
						{conversation.pinned ? 'Desafixar' : 'Fixar'}
					</ContextMenuItem>
					<ContextMenuItem onSelect={() => setRenaming(true)}>
						<Icon icon='pencil' />
						Renomear
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<Dialog open={renaming} onClose={() => setRenaming(false)} closeButton>
				<form onSubmit={rename}>
					<Dialog.Header>
						<Dialog.Title>Renomear conversa</Dialog.Title>
					</Dialog.Header>
					<Dialog.Body>
						<TextField
							name='title'
							size='sm'
							aria-label='Título'
							defaultValue={conversation.title ?? ''}
							maxLength={80}
							autoFocus
							onFocus={(e) => e.currentTarget.select()}
						/>
					</Dialog.Body>
					<Dialog.Footer>
						<div className='flex gap-2'>
							<Button type='button' variant='secondary' size='sm' onClick={() => setRenaming(false)}>
								Cancelar
							</Button>
							<Button type='submit' size='sm' loading={update.isPending}>
								Salvar
							</Button>
						</div>
					</Dialog.Footer>
				</form>
			</Dialog>
		</>
	);
}
