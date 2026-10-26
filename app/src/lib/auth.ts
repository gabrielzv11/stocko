const KEY = 'stocko:token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (token: string) => localStorage.setItem(KEY, token);
export const clearToken = () => localStorage.removeItem(KEY);
// Convite aberto sem sessão: guardado até o login voltar.
const INVITE_KEY = 'stocko:invite';
export const setPendingInvite = (code: string) => localStorage.setItem(INVITE_KEY, code);
export function takePendingInvite() {
	const code = localStorage.getItem(INVITE_KEY);
	localStorage.removeItem(INVITE_KEY);
	return code;
}
// Login iniciado nesta aba: só depois dele o /login#token= vale. Sem isso, um link com o token de outra pessoa
// logaria a vítima na conta do atacante (login CSRF). sessionStorage é por aba: um link aberto de fora não o tem.
const LOGIN_KEY = 'stocko:login-started';
export function startLogin() {
	sessionStorage.setItem(LOGIN_KEY, '1');
	window.location.assign(`${import.meta.env.VITE_API_URL}/auth/github/login`);
}
export function takeLoginStarted() {
	const started = sessionStorage.getItem(LOGIN_KEY) !== null;
	sessionStorage.removeItem(LOGIN_KEY);
	return started;
}
// Vincula as instalações do GitHub App ao workspace (só o dono) e abre a instalação no GitHub (conta + repos).
export const githubInstallUrl = (workspaceId: string) =>
	`${import.meta.env.VITE_API_URL}/github/install?workspace=${encodeURIComponent(workspaceId)}`;
