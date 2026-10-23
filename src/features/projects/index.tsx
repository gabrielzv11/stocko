import { Text } from '@/components/ui/text';
import { ProjectsList } from './projectsList';

export default function Projects() {
	return (
		<>
			<main className=''>
				<Text typography='h1'>Projetos</Text>

				<ProjectsList />
			</main>
		</>
	);
}
