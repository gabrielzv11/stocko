import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { toast } from 'sonner';
import { MembersSection } from './members';

type Provider = 'openrouter' | 'mangaba';

type Settings = {
	provider: Provider;
	model: string | null;
	hasMangabaKey: boolean;
	defaultModels: Record<Provider, string>;
};

const PROVIDERS: { id: Provider; label: string; description: string }[] = [
	{ id: 'openrouter', label: 'OpenRouter', description: 'Chave do servidor. Custo exato por resposta.' },
	{ id: 'mangaba', label: 'Mangaba Router', description: 'Sua chave (mr-...). O provedor não informa o custo.' },
];

function SettingsForm({ settings }: { settings: Settings }) {
	const [provider, setProvider] = useState(settings.provider);
	const queryClient = useQueryClient();

	const save = useMutation({
		mutationFn: (body: Record<string, string>) => api.put('/settings', body),
		onSuccess: () => {
			toast.success('Configurações salvas.');
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
	});

	function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const field = (k: string) => String(form.get(k) ?? '').trim();
		save.mutate({ provider, model: field('model'), ...(field('mangabaApiKey') && { mangabaApiKey: field('mangabaApiKey') }) });
	}

	const error = isAxiosError(save.error) ? (save.error.response?.data?.message ?? 'Dados inválidos.') : null;

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
			<fieldset className='flex flex-col gap-2'>
				<legend className='mb-2 text-base font-semibold'>Provedor do agente</legend>
				{PROVIDERS.map((p) => (
					<label
						key={p.id}
						className={cn(
							'border-card-border bg-card flex cursor-pointer items-start gap-3 rounded-2xl border p-4',
							provider === p.id && 'border-primary',
						)}
					>
						<input
							type='radio'
							name='provider'
							value={p.id}
							checked={provider === p.id}
							onChange={() => setProvider(p.id)}
							className='mt-1'
						/>
						<span>
							<span className='block font-medium'>{p.label}</span>
							<span className='text-muted-foreground text-sm'>{p.description}</span>
						</span>
					</label>
				))}
			</fieldset>

			{/* key: trocar de provedor limpa o modelo (slugs não servem de um para o outro). */}
			<label key={provider} className='flex flex-col gap-1 text-sm'>
				Modelo
				<TextField
					name='model'
					size='sm'
					defaultValue={provider === settings.provider ? (settings.model ?? '') : ''}
					placeholder={`Padrão: ${settings.defaultModels[provider]}`}
					helperText={
						provider === 'mangaba'
							? 'Use um modelo com tool calling e contexto grande (mangaba-titan tem 192k).'
							: 'Slug do OpenRouter, ex.: anthropic/claude-sonnet-5.5.'
					}
				/>
			</label>

			{provider === 'mangaba' && (
				<label className='flex flex-col gap-1 text-sm'>
					Chave do Mangaba Router
					<TextField
						name='mangabaApiKey'
						type='password'
						size='sm'
						autoComplete='off'
						required={!settings.hasMangabaKey}
						placeholder={settings.hasMangabaKey ? 'Chave salva. Preencha só para trocar.' : 'mr-...'}
						helperText='Salva criptografada; nunca é exibida de volta.'
					/>
				</label>
			)}

			{error && <p className='text-sm text-red-500'>{error}</p>}

			<div>
				<Button type='submit' size='sm' loading={save.isPending} className='w-auto px-6'>
					Salvar
				</Button>
			</div>
		</form>
	);
}

export default function SettingsPage() {
	const { data, isPending, isError } = useQuery({
		queryKey: ['settings'],
		queryFn: () => api.get<Settings>('/settings').then((r) => r.data),
	});

	return (
		<div className='mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6'>
			<h1 className='text-2xl font-semibold'>Configurações</h1>
			{isPending && <p className='text-muted-foreground text-sm'>Carregando...</p>}
			{isError && <p className='text-sm text-red-500'>Não foi possível carregar as configurações.</p>}
			{data && <SettingsForm settings={data} />}
			<MembersSection />
		</div>
	);
}
