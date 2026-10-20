import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { ProjectPicker } from '../projectPicker';
import { MarkdownEditor } from './markdownEditor';

interface Props {
	selectedIds: string[];
	onToggleProject: (id: string) => void;
	onSend: (content: string) => void;
	disabled?: boolean;
	className?: string;
}

function InputChat({ selectedIds, onToggleProject, onSend, disabled, className }: Props) {
	const [value, setValue] = useState('');
	const [expanded, setExpanded] = useState(false);
	const { data: projects = [] } = useProjects();
	const selected = projects.filter((p) => selectedIds.includes(p.id));
	const canSend = !!value.trim() && !disabled;

	function send() {
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
		setExpanded(false);
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				send();
			}}
			onKeyDown={(e) => e.key === 'Escape' && setExpanded(false)}
			// O form todo age como o campo: clicar fora de botões/chips foca o editor com o cursor no fim.
			onMouseDown={(e) => {
				if ((e.target as HTMLElement).closest('button, a, [contenteditable], [data-chip]')) return;
				e.preventDefault();
				const editor = e.currentTarget.querySelector<HTMLElement>('[contenteditable]')!;
				editor.focus();
				getSelection()?.selectAllChildren(editor);
				getSelection()?.collapseToEnd();
			}}
			className={cn('border-border bg-input flex cursor-text flex-col gap-1 rounded-3xl border p-2 [&_button]:cursor-pointer', className)}
		>
			{selected.length > 0 && (
				<div className='flex flex-wrap gap-1.5 px-2 pt-1'>
					{selected.map((project) => (
						<span
							key={project.id}
							data-chip
							className='bg-card flex cursor-default items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs'
						>
							{project.name}
							<button
								type='button'
								aria-label={`Remover ${project.name}`}
								onClick={() => onToggleProject(project.id)}
								className='text-muted-foreground hover:text-foreground rounded-full p-0.5'
							>
								<Icon icon='x' size='xs' />
							</button>
						</span>
					))}
				</div>
			)}

			<div className='relative'>
				<MarkdownEditor
					value={value}
					onChange={setValue}
					onSubmit={send}
					placeholder='Pergunte sobre seus projetos...'
					// min-height (0 → 60dvh) é animável, height: auto não; o campo cresce no lugar, empurrando a conversa.
					// ponytail: 60dvh fixo; se o host tiver pouca altura, trocar por flex-grow no container do Home.
					className={cn(
						'pr-10 transition-[min-height,max-height] duration-300 ease-out',
						expanded ? 'max-h-[60dvh] min-h-[60dvh]' : 'max-h-48 min-h-0',
					)}
				/>
				{(expanded || value) && (
					<button
						type='button'
						aria-label={expanded ? 'Sair da tela cheia' : 'Tela cheia'}
						onClick={() => setExpanded(!expanded)}
						// Mantém o foco (e o cursor) no editor.
						onMouseDown={(e) => e.preventDefault()}
						className='text-muted-foreground hover:bg-card hover:text-foreground absolute top-2 right-1 rounded-full p-1.5 transition-colors'
					>
						<Icon icon={expanded ? 'minimize-2' : 'maximize-2'} size='sm' />
					</button>
				)}
			</div>

			<div className='flex items-center justify-between'>
				<ProjectPicker selectedIds={selectedIds} onToggle={onToggleProject}>
					<button
						type='button'
						aria-label='Selecionar projetos'
						className='text-muted-foreground hover:bg-card hover:text-foreground data-[state=open]:bg-card flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm transition-colors'
					>
						<Icon icon='plus' size='sm' />
						<span className='hidden sm:inline'>Projetos</span>
					</button>
				</ProjectPicker>

				<IconButton type='submit' icon='arrow-up' size='sm' aria-label='Enviar' disabled={!canSend} className='rounded-full p-2' />
			</div>
		</form>
	);
}

export { InputChat };
