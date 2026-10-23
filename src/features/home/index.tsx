import { CircularProgress } from '@/components/ui/circularProgress';
import { InputChat } from '@/features/home/inputChat';
import { getToken } from '@/lib/auth';
import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, generateId, getToolName, isToolUIPart, type UIMessage } from 'ai';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { unsentIds, useConversationMessages } from './api';
import { Conversation, type Message, type Part } from './conversation';
import { Projects } from './projects';

const transport = new DefaultChatTransport({
	api: `${import.meta.env.VITE_API_URL}/conversations`,
	headers: (): Record<string, string> => ({ Authorization: `Bearer ${getToken()}` }),
	// Só a pergunta nova; o servidor guarda o histórico da conversa (id do useChat).
	prepareSendMessagesRequest: ({ api, id, messages, body }) => ({
		api: `${api}/${id}/messages`,
		body: { message: messages.at(-1), projectIds: body?.projectIds },
	}),
});

// Input das tools do stocko-service (src/agent.ts); chega parcial enquanto o modelo ainda escreve a chamada.
type ToolInput = {
	repo?: string;
	pattern?: string;
	regex?: string;
	glob?: string;
	path?: string;
	start?: number;
	end?: number;
};

function stepLabel(name: string, input: ToolInput = {}) {
	const repo = input.repo ? ` em ${input.repo}` : '';
	switch (name) {
		case 'list_repos':
			return 'Listando repositórios';
		case 'link_projects':
			return 'Vinculando a conversa ao projeto';
		case 'glob':
			return `Listando arquivos ${input.pattern ?? ''}${repo}`;
		case 'grep':
			return `Buscando "${input.regex ?? ''}"${input.glob ? ` (${input.glob})` : ''}${repo}`;
		case 'read_file':
			return `Lendo ${input.path ?? 'arquivo'}${input.start ? ` (linhas ${input.start}–${input.end ?? '…'})` : ''}${repo}`;
		default:
			return name;
	}
}

function toParts(m: UIMessage, live: boolean): Part[] {
	return m.parts.flatMap((p): Part[] => {
		if (p.type === 'text' || p.type === 'reasoning') return p.text ? [{ type: p.type, text: p.text }] : [];
		if (!isToolUIPart(p)) return [];
		// As tools devolvem erros como texto "erro: ..." (agent.ts) em vez de output-error.
		const failed = p.state === 'output-error' || (p.state === 'output-available' && String(p.output).startsWith('erro:'));
		return [
			{
				type: 'step',
				id: p.toolCallId,
				label: stepLabel(getToolName(p), p.input as ToolInput),
				// Stream interrompido não deixa spinner girando para sempre.
				done: p.state.startsWith('output') || !live,
				failed,
			},
		];
	});
}

interface Props {
	/** Conversa a abrir. Sem id (ex.: Module Federation), começa uma nova a cada montagem. */
	id?: string;
}

// Exposto via Module Federation: ocupa a altura do container do host e rola por dentro.
export default function Home({ id }: Props) {
	const [newId] = useState(generateId);
	// Congelado na montagem: o primeiro envio tira o id de unsentIds, e o histórico não pode recarregar no meio.
	const [unsent] = useState(() => !!id && unsentIds.has(id));
	const history = useConversationMessages(unsent ? undefined : id);

	if (history.isError) return <p className='text-muted-foreground p-6 text-center'>Não foi possível carregar a conversa.</p>;
	if (history.isLoading)
		return (
			<div className='text-muted-foreground flex h-full items-center justify-center'>
				<CircularProgress />
			</div>
		);
	return <Chat key={id ?? newId} id={id ?? newId} initialMessages={history.data ?? []} />;
}

function Chat({ id, initialMessages }: { id: string; initialMessages: UIMessage[] }) {
	const queryClient = useQueryClient();
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [quote, setQuote] = useState<string>();
	const chat = useChat({
		id,
		messages: initialMessages,
		transport,
		// Título, ordem e projetos vinculados mudam a cada turno.
		onFinish: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
		onError: () => toast.error('Não foi possível obter a resposta.'),
	});
	const typing = chat.status === 'submitted' || chat.status === 'streaming';
	const messages: Message[] = chat.messages
		.map((m, i) => {
			const streaming = chat.status === 'streaming' && i === chat.messages.length - 1;
			return {
				id: m.id,
				role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
				parts: toParts(m, streaming),
				streaming,
			};
		})
		// Assistente ainda sem nada: some, e o "digitando" continua visível.
		.filter((m) => m.parts.length);
	const empty = messages.length === 0;

	function toggleProject(id: string) {
		setSelectedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
	}

	function send(content: string) {
		unsentIds.delete(id);
		// Citação vai como blockquote no início do texto: o modelo lê como contexto e a conversa a separa ao exibir.
		const text = quote ? `${quote.replace(/^/gm, '> ')}\n\n${content}` : content;
		chat.sendMessage({ text }, { body: { projectIds: selectedIds } });
		setQuote(undefined);
	}

	return (
		<div className='flex h-full flex-col'>
			{empty ? (
				<div className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-6 px-4 pb-6'>
					<h1 className='text-center text-2xl font-semibold md:text-3xl'>Sobre o que vamos falar?</h1>
					<Projects selectedIds={selectedIds} onToggle={toggleProject} />
				</div>
			) : (
				<Conversation messages={messages} typing={typing} onAsk={setQuote} className='min-h-0 flex-1' />
			)}

			<motion.div layout='position' className='mx-auto w-full max-w-3xl px-4 pb-4'>
				<InputChat
					selectedIds={selectedIds}
					onToggleProject={toggleProject}
					onSend={send}
					quote={quote}
					onClearQuote={() => setQuote(undefined)}
					disabled={typing}
				/>
			</motion.div>

			{/* Desktop: espaçador inferior centraliza o composer no estado vazio */}
			{empty && <div className='hidden md:block md:flex-1' />}
		</div>
	);
}
