import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { env } from './env';

const app = { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY };

/** Octokit autenticado como a instalação (Installation.githubInstallationId); a lib renova o token de 1h sozinha. */
export const installationOctokit = (installationId: number) =>
	new Octokit({ authStrategy: createAppAuth, auth: { ...app, installationId } });

/** Token de instalação (1h) para git clone/fetch. */
export const installationToken = async (installationId: number) =>
	(await createAppAuth({ ...app, installationId })({ type: 'installation' })).token;
