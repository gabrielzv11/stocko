import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { toast } from 'sonner';

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
	text: string;
	label?: string;
}

export function CopyButton({ text, label = 'Copiar', className, ...props }: Props) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error('Não foi possível copiar.');
		}
	}

	return (
		<button
			type='button'
			onClick={copy}
			aria-label={copied ? 'Copiado' : label}
			title={copied ? 'Copiado' : label}
			className={cn(
				'text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-lg p-1.5 transition-colors',
				className,
			)}
			{...props}
		>
			<Icon icon={copied ? 'check' : 'copy'} size='sm' />
		</button>
	);
}
