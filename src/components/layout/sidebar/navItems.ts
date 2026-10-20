import type { IconName } from '@/components/ui/icons';

export interface NavItem {
	title: string;
	icon: IconName;
	to: string;
}

export interface ConversationItem {
	id: string;
	title: string;
	icon?: IconName;
}

export const navItems: NavItem[] = [
	{ title: 'Nova conversa', icon: 'plus', to: '/' },
	{ title: 'Projetos', icon: 'folder', to: '/projects' },
];

// TODO: substituir pelos dados da API
export const pinnedItems: ConversationItem[] = [{ id: 'p1', title: 'artiux-app', icon: 'folder' }];

export const recentItems: ConversationItem[] = [
	{ id: 'r1', title: 'Reposição de produtos' },
	{ id: 'r2', title: 'Relatório de vendas do trimestre' },
	{ id: 'r3', title: 'Cadastro de fornecedores' },
	{ id: 'r4', title: 'Integração com ERP' },
];
