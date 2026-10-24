import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

// Repositório do GitHub acessível pelo App, mais recente primeiro.
export type Repo = { id: string; name: string; fullName: string; url: string; private: boolean; pushedAt: string | null };

// Branch observada; a primeira (prioridade) é a que o agente lê por padrão.
export type Branch = {
	id: string;
	name: string;
	status: 'pending' | 'syncing' | 'ready' | 'error';
	lastSyncedSha: string | null;
	error: string | null;
};

// id = id do repo no GitHub; repositoryId = clone do workspace (rotas /repositories).
export type ProjectRepo = { id: string; repositoryId: string; fullName: string; branches: Branch[] };

export type Project = { id: string; name: string; repos: ProjectRepo[] };

export const useRepos = () => useQuery({ queryKey: ['repos'], queryFn: () => api.get<Repo[]>('/github/repos').then((r) => r.data) });

export const useRemoteBranches = (repositoryId: string, enabled: boolean) =>
	useQuery({
		queryKey: ['repositories', repositoryId, 'remote-branches'],
		queryFn: () => api.get<string[]>(`/repositories/${repositoryId}/remote-branches`).then((r) => r.data),
		enabled,
	});

// Spec OpenAPI/Swagger do projeto; sem baseUrl = só documentação.
export type ProjectApi = {
	id: string;
	title: string;
	description: string;
	usage: string;
	baseUrl: string | null;
	hasAuth: boolean;
};

// Doc enviado ou consulta do Jira; title = título do doc ou a JQL.
export type KnowledgeSource = {
	id: string;
	type: 'doc' | 'jira';
	title: string;
	baseUrl: string | null;
	status: 'syncing' | 'ready' | 'error' | null;
	error: string | null;
	syncedAt: string | null;
	chunks: number;
};

export const useKnowledge = (projectId: string) =>
	useQuery({
		queryKey: ['projects', projectId, 'knowledge'],
		queryFn: () => api.get<KnowledgeSource[]>(`/projects/${projectId}/knowledge`).then((r) => r.data),
		// Acompanha o sync do Jira até terminar.
		refetchInterval: (query) => (query.state.data?.some((s) => s.status === 'syncing') ? 3000 : false),
	});

export const useProjectApis = (projectId: string) =>
	useQuery({
		queryKey: ['projects', projectId, 'apis'],
		queryFn: () => api.get<ProjectApi[]>(`/projects/${projectId}/apis`).then((r) => r.data),
	});

const syncing = (projects?: Project[]) =>
	!!projects?.some((p) => p.repos.some((r) => r.branches.some((b) => b.status === 'pending' || b.status === 'syncing')));

export const useProjects = () =>
	useQuery({
		queryKey: ['projects'],
		queryFn: () => api.get<Project[]>('/projects').then((r) => r.data),
		// Acompanha o sync das branches até terminar.
		refetchInterval: (query) => (syncing(query.state.data) ? 3000 : false),
	});
