import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

// Repositório do GitHub acessível pelo App, mais recente primeiro.
export type Repo = { id: string; name: string; fullName: string; url: string; private: boolean; pushedAt: string | null };

export type Project = { id: string; name: string; repos: { id: string; fullName: string }[] };

export const useRepos = () => useQuery({ queryKey: ['repos'], queryFn: () => api.get<Repo[]>('/github/repos').then((r) => r.data) });

// Spec OpenAPI/Swagger do projeto; sem baseUrl = só documentação.
export type ProjectApi = {
	id: string;
	title: string;
	description: string;
	usage: string;
	baseUrl: string | null;
	hasAuth: boolean;
};

export const useProjectApis = (projectId: string) =>
	useQuery({
		queryKey: ['projects', projectId, 'apis'],
		queryFn: () => api.get<ProjectApi[]>(`/projects/${projectId}/apis`).then((r) => r.data),
	});

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects').then((r) => r.data) });
