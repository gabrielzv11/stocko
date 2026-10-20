const KEY = 'stocko:token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (token: string) => localStorage.setItem(KEY, token);
export const clearToken = () => localStorage.removeItem(KEY);
export const loginUrl = `${import.meta.env.VITE_API_URL}/auth/github/login`;
