import { Button } from '@/components/ui/button';
import { loginUrl, setToken } from '@/lib/auth';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const errors: Record<string, string> = {
	forbidden: 'Seu usuário do GitHub não tem acesso ao Stocko.',
};

// Também é o destino do callback do GitHub: o service redireciona para /login#token=... ou #error=...
export default function Login() {
	const navigate = useNavigate();
	const params = new URLSearchParams(window.location.hash.slice(1));
	const token = params.get('token');
	const error = params.get('error');

	useEffect(() => {
		if (!token) return;
		setToken(token);
		navigate('/', { replace: true });
	}, [token, navigate]);

	if (token) return null;

	return (
		<div className='flex h-dvh flex-col items-center justify-center gap-6 px-4'>
			<h1 className='text-2xl font-semibold md:text-3xl'>Stocko</h1>
			{error && (
				<p role='alert' className='text-muted-foreground text-center text-sm'>
					{errors[error] ?? 'Não foi possível entrar. Tente novamente.'}
				</p>
			)}
			<div className='w-full max-w-xs'>
				<Button onClick={() => window.location.assign(loginUrl)}>Entrar com GitHub</Button>
			</div>
		</div>
	);
}
