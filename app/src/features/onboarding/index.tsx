import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icons';
import { TextField } from '@/components/ui/textField';
import { api } from '@/lib/api';
import { getToken, githubInstallUrl, setPendingInvite } from '@/lib/auth';
import { logout, useMe } from '@/lib/me';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

const errorMessage = (e: unknown) => (isAxiosError(e) ? (e.response?.data?.message ?? 'Não foi possível concluir.') : null);

/** Entra no workspace do convite; recarrega para todas as queries passarem a ser dele. */
const acceptInvite = (code: string) => api.post(`/invites/${encodeURIComponent(code)}/accept`).then(() => window.location.assign('/'));

/** Aceita colar o link inteiro (…/invite/<código>) ou só o código. */
const inviteCode = (input: string) => input.trim().split('/invite/').pop()!.split(/[?#/]/)[0]!;

function Card({ icon, title, description, children }: { icon: IconName; title: string; description: string; children: React.ReactNode }) {
	return (
		<section className='border-card-border bg-card flex w-full max-w-sm flex-col gap-4 rounded-2xl border p-6'>
			<Icon icon={icon} size='lg' className='text-primary' />
			<div className='flex flex-col gap-1'>
				<h2 className='text-lg font-semibold'>{title}</h2>
				<p className='text-muted-foreground text-sm'>{description}</p>
			</div>
			<div className='mt-auto'>{children}</div>
		</section>
	);
}

/** Pós-login sem workspace (ou "Novo workspace" no perfil): criar um ou entrar por convite. */
export default function Onboarding() {
	const { data: me } = useMe();

	// Criado → já conecta o GitHub (o dono vincula as instalações e escolhe os repos).
	const create = useMutation({
		mutationFn: (name: string) => api.post<{ id: string }>('/workspaces', { name }),
		onSuccess: ({ data }) => window.location.assign(githubInstallUrl(data.id)),
	});
	const join = useMutation({ mutationFn: acceptInvite });

	function handleCreate(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const name = String(new FormData(e.currentTarget).get('name')).trim();
		if (name) create.mutate(name);
	}

	function handleJoin(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		const code = inviteCode(String(new FormData(e.currentTarget).get('code')));
		if (code) join.mutate(code);
	}

	if (!me) return null;
	const createError = errorMessage(create.error);
	const joinError = errorMessage(join.error);

	return (
		<div className='flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10'>
			<div className='flex flex-col items-center gap-2 text-center'>
				<h1 className='text-2xl font-semibold md:text-3xl'>Bem-vindo ao Stocko{me.name ? `, ${me.name}` : ''}</h1>
				<p className='text-muted-foreground text-sm'>Projetos, conversas e repositórios ficam em um workspace.</p>
			</div>

			<div className='flex w-full flex-col items-center justify-center gap-4 md:flex-row md:items-stretch'>
				<Card icon='plus' title='Criar workspace' description='Você será o dono: conecta o GitHub, escolhe os repositórios e convida o time.'>
					{me.canCreateWorkspace ? (
						<form onSubmit={handleCreate} className='flex flex-col gap-2'>
							<TextField name='name' size='sm' placeholder='Nome do workspace' maxLength={60} required autoComplete='off' />
							{createError && <p className='text-sm text-red-500'>{createError}</p>}
							<Button type='submit' size='sm' loading={create.isPending}>
								Criar e conectar ao GitHub
							</Button>
						</form>
					) : (
						<p className='text-muted-foreground text-sm'>Nesta instância, só logins autorizados criam workspaces. Peça um convite.</p>
					)}
				</Card>

				<Card icon='users' title='Entrar com convite' description='Cole o link ou o código que o dono do workspace enviou.'>
					<form onSubmit={handleJoin} className='flex flex-col gap-2'>
						<TextField name='code' size='sm' placeholder='Link ou código do convite' required autoComplete='off' />
						{joinError && <p className='text-sm text-red-500'>{joinError}</p>}
						<Button type='submit' size='sm' loading={join.isPending}>
							Entrar no workspace
						</Button>
					</form>
				</Card>
			</div>

			<div className='text-muted-foreground flex gap-4 text-sm'>
				{me.workspaceId && (
					<Link to='/' className='underline'>
						Voltar
					</Link>
				)}
				<button type='button' className='underline' onClick={logout}>
					Sair
				</button>
			</div>
		</div>
	);
}

/** Link de convite (/invite/:code): sem sessão, guarda o código e volta aqui depois do login. */
export function InvitePage() {
	const { code = '' } = useParams();
	const token = getToken();
	const join = useMutation({ mutationFn: acceptInvite });
	const { mutate } = join;

	useEffect(() => {
		if (token) mutate(code);
	}, [token, code, mutate]);

	if (!token) {
		setPendingInvite(code);
		return <Navigate to='/login' replace />;
	}

	return (
		<div className='flex h-dvh flex-col items-center justify-center gap-4 px-4 text-center'>
			{join.isError ? (
				<>
					<p className='text-sm text-red-500'>{errorMessage(join.error)}</p>
					<Link to='/welcome' className='text-muted-foreground text-sm underline'>
						Criar um workspace ou usar outro convite
					</Link>
				</>
			) : (
				<p className='text-muted-foreground text-sm'>Entrando no workspace...</p>
			)}
		</div>
	);
}
