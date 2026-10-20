const KEY = 'stocko:token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (token: string) => localStorage.setItem(KEY, token);
export const clearToken = () => localStorage.removeItem(KEY);
export const loginUrl = `${import.meta.env.VITE_API_URL}/auth/github/login`;
// Instala o GitHub App (conta + repos); o GitHub volta pelo login, que vincula a instalação.
export const githubInstallUrl = `${import.meta.env.VITE_API_URL}/github/install`;
