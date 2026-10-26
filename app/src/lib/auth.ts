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
export const loginUrl = `${import.meta.env.VITE_API_URL}/auth/github/login`;
// Vincula as instalações do GitHub App ao workspace (só o dono) e abre a instalação no GitHub (conta + repos).
export const githubInstallUrl = (workspaceId: string) =>
	`${import.meta.env.VITE_API_URL}/github/install?workspace=${encodeURIComponent(workspaceId)}`;
