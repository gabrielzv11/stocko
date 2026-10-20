import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from './lib/tanstack-query';
import { Router } from './router';

// Shell usado apenas no modo standalone. O host consome as features expostas em vite.config.ts.
function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<Router />
			<Toaster position='bottom-right' />
		</QueryClientProvider>
	);
}

export default App;
