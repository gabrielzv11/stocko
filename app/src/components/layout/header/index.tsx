import Dialog from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/iconButton';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConversations } from '@/features/home/api';
import { ConversationMenu } from '@/features/home/conversationMenu';
import { ShareButton } from '@/features/home/share';
import { CreateWorkspaceForm, JoinWorkspaceForm } from '@/features/onboarding';
import { switchWorkspace, useMe } from '@/lib/me';
import { openContextMenu } from '@/lib/openContextMenu';
import { useState } from 'react';
import { useMatch } from 'react-router-dom';

// Item-ação no fim da lista: abre o diálogo em vez de trocar de workspace.
const ADD_WORKSPACE = '__add';

function WorkspaceSelect() {
	const { data: me } = useMe();
	const [adding, setAdding] = useState(false);

	if (!me?.workspaceId) return null;

	function handleChange(value: string) {
		if (value === ADD_WORKSPACE) setAdding(true);
		else switchWorkspace(value);
	}

	return (
		<>
			<div className='w-56'>
				<Select value={me.workspaceId} onValueChange={handleChange}>
					<SelectTrigger size='sm' typography='body' ornament='building-2' aria-label='Workspace'>
						<SelectValue>{me.workspaces.find((w) => w.id === me.workspaceId)?.name}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectLabel>Workspace</SelectLabel>
						<SelectGroup>
							{me.workspaces.map((w) => (
								<SelectItem key={w.id} value={w.id} typography='body'>
									{w.name}
								</SelectItem>
							))}
							<SelectItem value={ADD_WORKSPACE} typography='body'>
								<span className='flex items-center gap-2'>
									<Icon icon='plus' size='sm' />
									Adicionar workspace
								</span>
							</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>

			<Dialog open={adding} onClose={() => setAdding(false)} closeButton>
				<Dialog.Header>
					<Dialog.Title>Adicionar workspace</Dialog.Title>
				</Dialog.Header>
				<Dialog.Body>
					<div className='flex flex-col gap-6'>
						{me.canCreateWorkspace && (
							<section className='flex flex-col gap-2'>
								<h4 className='text-sm font-medium'>Criar workspace</h4>
								<CreateWorkspaceForm />
							</section>
						)}
						<section className='flex flex-col gap-2'>
							<h4 className='text-sm font-medium'>Entrar com convite</h4>
							<p className='text-muted-foreground text-sm'>Cole o link ou o código que o dono do workspace enviou.</p>
							<JoinWorkspaceForm />
						</section>
					</div>
				</Dialog.Body>
			</Dialog>
		</>
	);
}

function Header() {
	const id = useMatch('/c/:id')?.params.id;
	// Só conversa já salva (aparece na lista após o primeiro turno) tem link para compartilhar e menu.
	const conversation = useConversations().data?.find((c) => c.id === id);

	return (
		<header className='flex shrink-0 items-center justify-between gap-1 p-2'>
			<WorkspaceSelect />
			{conversation && (
				<div className='flex items-center gap-1'>
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
				</div>
			)}
		</header>
	);
}

export { Header };
