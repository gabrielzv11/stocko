import { Icon } from '@/components/ui/icons';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { toast } from 'sonner';

type Value = 1 | -1 | null;

/** 👍/👎 numa resposta; clicar no já marcado desmarca. */
export function Feedback({ messageId, initial }: { messageId: string; initial: Value }) {
	const [value, setValue] = useState<Value>(initial);

	async function rate(next: 1 | -1) {
		const sent = value === next ? null : next;
		const previous = value;
		setValue(sent);
		try {
			await api.put(`/messages/${messageId}/feedback`, { value: sent });
		} catch {
			setValue(previous);
			toast.error('Não foi possível salvar a avaliação.');
		}
	}

	return (
		<>
			{([1, -1] as const).map((v) => (
				<button
					key={v}
					type='button'
					onClick={() => rate(v)}
					aria-label={v === 1 ? 'Resposta boa' : 'Resposta ruim'}
					aria-pressed={value === v}
					title={v === 1 ? 'Resposta boa' : 'Resposta ruim'}
					className={cn(
						'text-muted-foreground hover:bg-muted hover:text-foreground flex items-center rounded-lg p-1.5 transition-colors',
						value === v && 'text-foreground',
					)}
				>
					<Icon icon={v === 1 ? 'thumbs-up' : 'thumbs-down'} size='sm' className={cn(value === v && 'fill-current')} />
				</button>
			))}
		</>
	);
}
