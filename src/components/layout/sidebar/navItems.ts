import type { IconName } from '@/components/ui/icons';

export interface NavItem {
	title: string;
	icon: IconName;
	to: string;
}

export const navItems: NavItem[] = [
	{ title: 'Nova conversa', icon: 'plus', to: '/' },
	{ title: 'Projetos', icon: 'folder', to: '/projects' },
];
