import { CircularProgress } from '@/components/ui/circularProgress';
import { Conversation, type Message } from '@/features/home/conversation';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

type Shared = { title: string | null; messages: Message[] };

/** /s/:token — conversa compartilhada, sem login e só leitura. */
export default function SharedConversation() {
	const { token } = useParams();
	const { data, isPending, isError } = useQuery({
		queryKey: ['shared', token],
		queryFn: () => api.get<Shared>(`/shared/${token}`).then((r) => r.data),
		retry: false,
	});

	return (
		<div className='bg-background flex h-dvh flex-col'>
			<header className='border-border flex items-center gap-2 border-b px-4 py-3'>
				<span className='font-semibold'>Stocko</span>
				<span className='text-muted-foreground truncate text-sm'>{data?.title ? `· ${data.title}` : ''}</span>
				<span className='text-muted-foreground ml-auto shrink-0 text-xs'>Somente leitura</span>
			</header>
			{isPending && (
				<div className='text-muted-foreground flex flex-1 items-center justify-center'>
					<CircularProgress />
				</div>
			)}
			{isError && <p className='text-muted-foreground p-6 text-center'>Link inválido ou revogado.</p>}
			{data && <Conversation messages={data.messages} readOnly className='min-h-0 flex-1' />}
		</div>
	);
}
