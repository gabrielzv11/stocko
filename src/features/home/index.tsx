import { InputChat } from '@/features/home/inputChat';
import { useProjects } from '@/features/projects/api';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Conversation, type Message } from './conversation';
import { Projects } from './projects';

// Exposto via Module Federation: ocupa a altura do container do host e rola por dentro.
export default function Home() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [typing, setTyping] = useState(false);
	const { data: projects = [] } = useProjects();
	const empty = messages.length === 0;

	function toggleProject(id: string) {
		setSelectedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
	}

	function send(content: string) {
		setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content }]);
		setTyping(true);

		// ponytail: resposta simulada via setInterval até existir POST /conversations/:id/messages no service
		const names = projects.filter((p) => selectedIds.includes(p.id)).map((p) => p.name);
		const reply = `Resposta simulada${names.length ? ` com base em: ${names.join(', ')}` : ''}.\n\nEsta mensagem chega em pedaços para simular o streaming: cada letra nova aparece com fade de opacidade. A integração com a API ainda não foi feita.`;
		const id = crypto.randomUUID();
		const update = (patch: Partial<Message>) =>
			setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

		setTimeout(() => {
			setMessages((prev) => [...prev, { id, role: 'assistant', content: '', streaming: true }]);

			let length = 0;
			const timer = setInterval(() => {
				length += 3;
				update({ content: reply.slice(0, length) });
				if (length < reply.length) return;

				clearInterval(timer);
				setTyping(false);
				// espera o fade das últimas letras antes de trocar spans por texto puro
				setTimeout(() => update({ streaming: false }), 400);
			}, 30);
		}, 800);
	}

	return (
		<div className='flex h-full flex-col'>
			{empty ? (
				<div className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-6 px-4 pb-6'>
					<h1 className='text-center text-2xl font-semibold md:text-3xl'>Sobre o que vamos falar?</h1>
					<Projects selectedIds={selectedIds} onToggle={toggleProject} />
				</div>
			) : (
				<Conversation messages={messages} typing={typing} className='min-h-0 flex-1' />
			)}

			<motion.div layout='position' className='mx-auto w-full max-w-3xl px-4 pb-4'>
				<InputChat
					selectedIds={selectedIds}
					onToggleProject={toggleProject}
					onSend={send}
					disabled={typing}
				/>
			</motion.div>

			{/* Desktop: espaçador inferior centraliza o composer no estado vazio */}
			{empty && <div className='hidden md:block md:flex-1' />}
		</div>
	);
}
