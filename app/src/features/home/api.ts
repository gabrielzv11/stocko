import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { isAxiosError } from 'axios';

type LinkedProject = { id: string; name: string };

export type ConversationSummary = {
	id: string;
	title: string | null;
	pinned: boolean;
	updatedAt: string;
	projects: LinkedProject[];
};

/** Ids criados nesta aba e ainda sem mensagem: nada a buscar. Em memória, para um reload buscar o que foi salvo. */
export const unsentIds = new Set<string>();

export const useConversations = () =>
	useQuery({
		queryKey: ['conversations'],
		queryFn: () => api.get<ConversationSummary[]>('/conversations').then((r) => r.data),
	});

/** Histórico salvo; conversa que ainda não teve mensagem (404) começa vazia. */
export const useConversationMessages = (id: string | undefined) =>
	useQuery({
		queryKey: ['conversation', id],
		queryFn: () =>
			api
				.get<{ messages: UIMessage[] }>(`/conversations/${id}`)
				.then((r) => r.data.messages)
				.catch((e) => {
					if (isAxiosError(e) && e.response?.status === 404) return [];
					throw e;
				}),
		enabled: !!id,
		// Sempre do servidor ao abrir: o useChat só lê as mensagens iniciais uma vez.
		gcTime: 0,
	});
