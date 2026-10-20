import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';

export type Message = { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean };

interface Props extends React.HTMLAttributes<HTMLDivElement> {
	messages: Message[];
	typing?: boolean;
}

// ponytail: um motion.span por letra, só enquanto a mensagem está em streaming; agrupar por palavra se respostas longas pesarem
function StreamingText({ text }: { text: string }) {
	return (
		<>
			{Array.from(text).map((char, i) => (
				<motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
					{char}
				</motion.span>
			))}
		</>
	);
}

function Conversation({ messages, typing, className, ...props }: Props) {
	const endRef = useRef<HTMLDivElement>(null);
	const last = messages.at(-1);
	// "Digitando" só até o primeiro pedaço da resposta chegar
	const waiting = typing && last?.role === 'user';

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [messages.length, last?.content.length, waiting]);

	return (
		<div className={cn('overflow-y-auto', className)} {...props}>
			<div className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
				{messages.map((message) =>
					message.role === 'user' ? (
						<div
							key={message.id}
							className='max-w-[85%] self-end rounded-2xl bg-card px-4 py-2.5 whitespace-pre-wrap'
						>
							{message.content}
						</div>
					) : (
						<div key={message.id} className='leading-relaxed whitespace-pre-wrap'>
							{message.streaming ? <StreamingText text={message.content} /> : message.content}
						</div>
					)
				)}

				{waiting && (
					<div role='status' aria-label='Digitando' className='flex gap-1 py-2'>
						{[0, 1, 2].map((i) => (
							<motion.span
								key={i}
								className='size-2 rounded-full bg-muted-foreground'
								animate={{ opacity: [0.3, 1, 0.3] }}
								transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
							/>
						))}
					</div>
				)}

				<div ref={endRef} />
			</div>
		</div>
	);
}

export { Conversation };
