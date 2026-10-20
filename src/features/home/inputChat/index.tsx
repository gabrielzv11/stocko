import { IconButton } from '@/components/ui/iconButton';
import { Icon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/textField';
import { mockProjects } from '@/features/projects/mock';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { ProjectPicker } from '../projectPicker';

interface Props {
	selectedIds: string[];
	onToggleProject: (id: string) => void;
	onSend: (content: string) => void;
	disabled?: boolean;
	className?: string;
}

function InputChat({ selectedIds, onToggleProject, onSend, disabled, className }: Props) {
	const [value, setValue] = useState('');
	const selected = mockProjects.filter((p) => selectedIds.includes(p.id));
	const canSend = !!value.trim() && !disabled;

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!canSend) return;
		onSend(value.trim());
		setValue('');
	}

	return (
		<form
			onSubmit={handleSubmit}
			className={cn('flex flex-col gap-1 rounded-3xl border border-border bg-input p-2', className)}
		>
			{selected.length > 0 && (
				<div className='flex flex-wrap gap-1.5 px-2 pt-1'>
					{selected.map((project) => (
						<span
							key={project.id}
							className='flex items-center gap-1 rounded-full bg-card py-0.5 pr-1 pl-2.5 text-xs'
						>
							{project.name}
							<button
								type='button'
								aria-label={`Remover ${project.name}`}
								onClick={() => onToggleProject(project.id)}
								className='rounded-full p-0.5 text-muted-foreground hover:text-foreground'
							>
								<Icon icon='x' size='xs' />
							</button>
						</span>
					))}
				</div>
			)}

			<TextField
				name='message'
				multiline
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					// Enter envia, Shift+Enter quebra linha
					if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						e.currentTarget.form?.requestSubmit();
					}
				}}
				placeholder='Pergunte sobre seus projetos...'
				aria-label='Mensagem'
				className='bg-transparent px-2'
			/>

			<div className='flex items-center justify-between'>
				<ProjectPicker selectedIds={selectedIds} onToggle={onToggleProject}>
					<button
						type='button'
						aria-label='Selecionar projetos'
						className='flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground data-[state=open]:bg-card'
					>
						<Icon icon='plus' size='sm' />
						<span className='hidden sm:inline'>Projetos</span>
					</button>
				</ProjectPicker>

				<IconButton
					type='submit'
					icon='arrow-up'
					size='sm'
					aria-label='Enviar'
					disabled={!canSend}
					className='rounded-full p-2'
				/>
			</div>
		</form>
	);
}

export { InputChat };
