import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			networkMode: 'always',
			retry: 1,
			retryDelay: 1000,
			refetchOnWindowFocus: false,
		},
	},
});
