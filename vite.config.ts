import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
	const env = loadEnv(mode, process.cwd(), '');
	// Federation só no build ou em `dev:mf` (testar com host); `dev` puro roda standalone e sobe rápido.
	const withFederation = command === 'build' || mode === 'mf';

	return {
		base: command === 'build' && env.VITE_PUBLIC_URL ? `${env.VITE_PUBLIC_URL}/` : '/',
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src'),
			},
			dedupe: ['react', 'react-dom', '@tanstack/react-query'],
		},
		server: {
			port: 5003,
			strictPort: true,
		},
		build: {
			target: 'esnext',
			cssCodeSplit: true,
		},
		plugins: [
			react(),
			tailwindcss(),
			withFederation && federation({
				name: 'stocko',
				manifest: true,
				exposes: {
					'./home': './src/features/home/index.tsx',
				},
				shared: {
					react: { singleton: true, requiredVersion: '^19.0.0' },
					'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
					'react-router-dom': { singleton: true, requiredVersion: '^7.0.0' },
					'@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
					axios: {},
					dayjs: {},
					sonner: {},
				},
				dts: false,
			}),
		],
	};
});
