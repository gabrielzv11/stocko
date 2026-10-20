import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/iconButton';
import { List } from '@/components/ui/list';
import { TextField } from '@/components/ui/textField';
import { useState } from 'react';
import { mockProjects, type Project } from '../mock';

interface Props extends React.HTMLAttributes<HTMLDivElement> {}

function ProjectsList({ ...props }: Props) {
	// ponytail: local state only, swap for react-query + api when the projects endpoint exists
	const [projects, setProjects] = useState<Project[]>(mockProjects);
	const [editing, setEditing] = useState<Project | null>(null);

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const name = String(new FormData(e.currentTarget).get('name')).trim();
		if (!name) return;

		if (editing) {
			setProjects((prev) => prev.map((p) => (p.id === editing.id ? { ...p, name } : p)));
			setEditing(null);
		} else {
			setProjects((prev) => [...prev, { id: crypto.randomUUID(), name }]);
		}
		e.currentTarget.reset();
	}

	function handleDelete(id: string) {
		setProjects((prev) => prev.filter((p) => p.id !== id));
		if (editing?.id === id) setEditing(null);
	}

	return (
		<div {...props}>
			<form onSubmit={handleSubmit} className='flex gap-2 px-12 py-4'>
				<TextField
					key={editing?.id ?? 'new'}
					name='name'
					placeholder='Nome do projeto'
					defaultValue={editing?.name}
				/>
				<Button type='submit' className='w-max'>
					{editing ? 'Salvar' : 'Adicionar'}
				</Button>
				{editing && (
					<Button variant='secondary' className='w-max' onClick={() => setEditing(null)}>
						Cancelar
					</Button>
				)}
			</form>

			<List
				items={projects}
				onItemClick={setEditing}
				renderItem={(project) => (
					<>
						<h3 className='text-xl font-semibold'>{project.name}</h3>
						<IconButton
							icon='trash-2'
							variant='ghost'
							color='destructive'
							size='sm'
							aria-label='Excluir projeto'
							onClick={(e) => {
								e.stopPropagation();
								handleDelete(project.id);
							}}
						/>
					</>
				)}
			/>
		</div>
	);
}

export { ProjectsList };
