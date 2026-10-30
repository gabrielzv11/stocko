import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export type Sum = { cost: number; inputTokens: number; outputTokens: number; cachedTokens: number; turns: number };

export type Usage = {
	since: string;
	days: number;
	totals: Sum;
	byDay: ({ day: string } & Sum)[];
	byModel: ({ model: string } & Sum)[];
	bySource: ({ source: 'chat' | 'mcp' } & Sum)[];
	byProject: ({ id: string; name: string } & Sum)[];
	byConversation: ({ id: string; title: string } & Sum)[];
};

const TEN_MINUTES = 10 * 60_000;
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Cache de 10 min: voltar à tela não refaz o fetch; com a tela aberta, atualiza sozinho a cada 10 min.
export const useUsage = () =>
	useQuery({
		queryKey: ['usage', tz],
		queryFn: () => api.get<Usage>('/usage', { params: { tz } }).then((r) => r.data),
		staleTime: TEN_MINUTES,
		refetchInterval: TEN_MINUTES,
	});
