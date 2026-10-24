import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ProjectPicker } from '../projectPicker';
import { MarkdownEditor } from './markdownEditor';

interface Props {
	selectedIds: string[];
	onToggleProject: (id: string) => void;
	onSend: (content: string) => void;
	/** Trecho da conversa que acompanha a próxima pergunta. */
	quote?: string;
	onClearQuote?: () => void;
	disabled?: boolean;
	className?: string;
}

function focusEditor(form: HTMLFormElement) {
	const editor = form.querySelector<HTMLElement>('[contenteditable]')!;
	editor.focus();
	getSelection()?.selectAllChildren(editor);
	getSelection()?.collapseToEnd();
}

function InputChat({ selectedIds, onToggleProject, onSend, quote, onClearQuote, disabled, className }: Props) {
	const formRef = useRef<HTMLFormElement>(null);
	const [value, setValue] = useState('');
	const [expanded, setExpanded] = useState(false);
	const [focused, setFocused] = useState(false);
	// Comprimido só sem foco e vazio.
	const open = focused || !!value;
	const { data: projects = [] } = useProjects();
	const selected = projects.filter((p) => selectedIds.includes(p.id));
	const canSend = !!value.trim() && !disabled;

	// "Perguntar sobre" leva direto para a digitação.
	useEffect(() => {
		if (quote) focusEditor(formRef.current!);
	}, [quote]);

	function send() {
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
		setExpanded(false);
	}

	return (
		<motion.form
			ref={formRef}
			// Sem foco fica comprimido: "+ Projetos" e editor lado a lado, sem enviar/tela cheia.
			// Troca row/column não anima em CSS; o layout do motion anima a altura (só quando abre/comprime).
			layout
			layoutDependency={open}
			transition={{ duration: 0.25, ease: 'easeOut' }}
			// borderRadius via style para o motion corrigir a distorção durante a animação.
			style={{ borderRadius: 24 }}
			onFocus={() => setFocused(true)}
			// Foco indo para outro elemento do form (ex.: botões) não comprime.
			onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
			onSubmit={(e) => {
				e.preventDefault();
				send();
			}}
			onKeyDown={(e) => e.key === 'Escape' && setExpanded(false)}
			// O form todo age como o campo: clicar fora de botões/chips foca o editor com o cursor no fim.
			onMouseDown={(e) => {
				if ((e.target as HTMLElement).closest('button, a, [contenteditable], [data-chip]')) return;
				e.preventDefault();
				focusEditor(e.currentTarget);
			}}
			className={cn(
				'border-border bg-input flex cursor-text flex-wrap gap-1 border p-2 [&_button]:cursor-pointer',
				open ? 'flex-col' : 'items-center',
				className,
			)}
		>
			{(selected.length > 0 || quote) && (
				<motion.div layout='position' layoutDependency={open} className='order-first flex w-full flex-wrap gap-1.5 px-2 pt-1'>
					{quote && (
						<span
							data-chip
							title={quote}
							className='bg-card flex max-w-full cursor-default items-center gap-1.5 rounded-full py-0.5 pr-1 pl-2.5 text-xs'
						>
							<Icon icon='text-quote' size='xs' className='text-muted-foreground shrink-0' />
							<span className='truncate'>{quote}</span>
							<button
								type='button'
								aria-label='Remover citação'
								onClick={onClearQuote}
								className='text-muted-foreground hover:text-foreground rounded-full p-0.5'
							>
								<Icon icon='x' size='xs' />
							</button>
						</span>
					)}
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
				</motion.div>
			)}

			<motion.div layout='position' layoutDependency={open} className='relative min-w-0 flex-1'>
				<MarkdownEditor
					value={value}
					onChange={setValue}
					onSubmit={send}
					placeholder='Pergunte sobre seus projetos...'
					// min-height (0 → 60dvh) é animável, height: auto não; o campo cresce no lugar, empurrando a conversa.
					// ponytail: 60dvh fixo; se o host tiver pouca altura, trocar por flex-grow no container do Home.
					className={cn(
						'transition-[min-height,max-height] duration-300 ease-out',
						open && 'pr-10',
						expanded ? 'max-h-[60dvh] min-h-[60dvh]' : 'max-h-48 min-h-0',
					)}
				/>
				{open && (expanded || value) && (
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
			</motion.div>

			<motion.div layout='position' layoutDependency={open} className={cn('flex items-center justify-between', !open && '-order-1')}>
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

				{open && (
					<IconButton
						type='submit'
						icon='arrow-up'
						size='sm'
						aria-label='Enviar'
						disabled={!canSend}
						// Safari não foca botão no clique: sem isso o blur comprime o form antes do submit.
						onMouseDown={(e) => e.preventDefault()}
						className='rounded-full p-2'
					/>
				)}
			</motion.div>
		</motion.form>
	);
}

export { InputChat };
