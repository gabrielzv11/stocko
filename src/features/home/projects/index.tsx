import { Icon } from '@/components/ui/icons';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/cn';
import { ProjectPicker } from '../projectPicker';

interface Props {
	selectedIds: string[];
	onToggle: (id: string) => void;
}

const cardClass =
	'flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-card';

function Projects({ selectedIds, onToggle }: Props) {
	const { data: projects = [] } = useProjects();
	const recent = projects.slice(0, 5);

	return (
		<div className='flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible md:pb-0'>
			{recent.map((project) => {
				const selected = selectedIds.includes(project.id);

				return (
					<button
						key={project.id}
						type='button'
						aria-pressed={selected}
						onClick={() => onToggle(project.id)}
						className={cn(cardClass, selected && 'border-ring bg-card')}
					>
						<Icon icon={selected ? 'circle-check' : 'folder'} size='sm' className='shrink-0' />
						<span className='truncate'>{project.name}</span>
					</button>
				);
			})}

			<ProjectPicker selectedIds={selectedIds} onToggle={onToggle}>
				<button type='button' className={cn(cardClass, 'text-muted-foreground')}>
					<Icon icon='plus' size='sm' className='shrink-0' />
					Escolher outro
				</button>
			</ProjectPicker>
		</div>
	);
}

export { Projects };
