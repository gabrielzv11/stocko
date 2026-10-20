import { IconButton } from '@/components/ui/iconButton';

interface Props {
	onMenuClick: () => void;
}

function Header({ onMenuClick }: Props) {
	return (
		<>
			<header className='flex shrink-0 items-center p-2'>
				<IconButton icon='menu' variant='ghost' size='sm' aria-label='Alternar menu' onClick={onMenuClick} />
			</header>
		</>
	);
}

export { Header };
