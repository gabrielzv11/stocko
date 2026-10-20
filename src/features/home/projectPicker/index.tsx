import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdownMenu';
import { mockProjects } from '@/features/projects/mock';

interface Props {
	selectedIds: string[];
	onToggle: (id: string) => void;
	/** Trigger: precisa ser um elemento DOM (ex.: <button>) para o Radix posicionar o menu. */
	children: React.ReactNode;
}

function ProjectPicker({ selectedIds, onToggle, children }: Props) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent className='w-56'>
				<DropdownMenuLabel>Projetos</DropdownMenuLabel>
				{mockProjects.map((project) => (
					<DropdownMenuCheckboxItem
						key={project.id}
						checked={selectedIds.includes(project.id)}
						onCheckedChange={() => onToggle(project.id)}
						// mantém o menu aberto para marcar vários
						onSelect={(e) => e.preventDefault()}
					>
						{project.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export { ProjectPicker };
