import { IconButton } from '@/components/ui/iconButton';
import { useConversations } from '@/features/home/api';
import { ConversationMenu } from '@/features/home/conversationMenu';
import { ShareButton } from '@/features/home/share';
import { openContextMenu } from '@/lib/openContextMenu';
import { useMatch } from 'react-router-dom';

function Header() {
	const id = useMatch('/c/:id')?.params.id;
	// Só conversa já salva (aparece na lista após o primeiro turno) tem link para compartilhar e menu.
	const conversation = useConversations().data?.find((c) => c.id === id);

	return (
		<header className='flex shrink-0 items-center justify-end gap-1 p-2'>
			{conversation && (
				<>
					<ShareButton conversationId={conversation.id} />
					<ConversationMenu conversation={conversation}>
						<div>
							<IconButton
								icon='ellipsis'
								variant='ghost'
								size='sm'
								aria-label='Opções da conversa'
								onClick={openContextMenu}
							/>
						</div>
					</ConversationMenu>
				</>
			)}
		</header>
	);
}

export { Header };
