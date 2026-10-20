import axios from 'axios';
import { clearToken, getToken } from './auth';

export const api = axios.create({
	baseURL: import.meta.env.VITE_API_URL,
	headers: {
		'Content-Type': 'application/json',
		Accept: 'application/json',
	},
});

api.interceptors.request.use((config) => {
	const token = getToken();
	if (token) config.headers.Authorization = `Bearer ${token}`;
	return config;
});

// Sessão expirada/revogada: volta para o login.
api.interceptors.response.use(undefined, (error) => {
	if (error.response?.status === 401) {
		clearToken();
		window.location.assign('/login');
	}
	return Promise.reject(error);
});
