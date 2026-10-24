import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export type Role = 'owner' | 'member';

export type Me = {
	id: string;
	name: string | null;
	avatarUrl: string | null;
	login: string | null;
	/** Workspace ativo da sessão. */
	workspaceId: string;
	role: Role;
	workspaces: { id: string; name: string; role: Role }[];
	hasInstallation: boolean;
	/** Login em ALLOWED_GITHUB_LOGINS: pode criar workspaces. */
	canCreateWorkspace: boolean;
};

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me').then((r) => r.data) });

/** Troca o workspace da sessão e recarrega: projetos, conversas e configurações são todos dele. */
export async function switchWorkspace(id: string) {
	await api.post(`/workspaces/${id}/switch`);
	window.location.assign('/');
}

/** Cria um workspace (já vira o ativo) e abre as configurações para renomear e conectar o GitHub. */
export async function createWorkspace() {
	await api.post('/workspaces', { name: 'Novo workspace' });
	window.location.assign('/settings');
}
