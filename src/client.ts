import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { env } from './env';

const app = { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY };

/** Octokit autenticado como a instalação (Installation.githubInstallationId); a lib renova o token de 1h sozinha. */
export const installationOctokit = (installationId: number) =>
	new Octokit({ authStrategy: createAppAuth, auth: { ...app, installationId } });

/** Clona (ou atualiza) um repo para o agente navegar */
export async function cloneRepo(installationId: number, owner: string, repo: string, dest: string): Promise<void> {
	const { token } = await createAppAuth({ ...app, installationId })({ type: 'installation' });
	const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
	const proc = Bun.spawn(['git', 'clone', '--depth=1', url, dest]);
	if ((await proc.exited) !== 0) throw new Error(`Falha ao clonar ${owner}/${repo}`);
}
