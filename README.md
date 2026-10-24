# Stocko

Chat com um agente que lê e explica os repositórios GitHub do seu produto, citando arquivo, linha e commit. Também consulta docs, Jira e APIs ligados ao projeto.

Open-source e self-hosted: você roda a instância, cria o próprio GitHub App e usa a sua chave de LLM.

| Pasta | O quê |
|---|---|
| [`service/`](service) | API: Bun + Hono + Prisma (Postgres). Clona os repos e roda o agente. |
| [`app/`](app) | Front: React + Vite. |

## Subir com Docker

Requisitos: Docker e uma chave do [OpenRouter](https://openrouter.ai/keys).

```sh
cp service/.env.example .env
bun service/scripts/setup-github.ts --api http://localhost:8000
```

O `setup:github` abre o GitHub com o App já configurado: você só confirma o nome, e ele grava as credenciais no `.env` da raiz. Para criar o App numa organização, use `--org <org>`. O nome precisa ser único no GitHub; troque com `--name "Stocko (Acme)"`.

No `.env`, preencha também:

- `ALLOWED_GITHUB_LOGINS`: seu login do GitHub (veja [Acesso e workspaces](#acesso-e-workspaces)).
- `OPENROUTER_API_KEY`.
- `SECRETS_KEY`: gere com `openssl rand -base64 32`.

Depois:

```sh
docker compose up -d --build
```

Abra http://localhost:5003, entre com o GitHub e, no menu do perfil, clique em **Conectar ao GitHub** para instalar o App nas contas e repos que o agente pode ler.

### Domínio próprio

A URL da API entra no bundle do front durante o build, e a URL do front vai para o CORS da API:

```sh
API_URL=https://api.exemplo.com APP_URL=https://stocko.exemplo.com docker compose up -d --build
```

Crie o App com `--api https://api.exemplo.com`. Com a API pública, o script também configura o webhook de push, que mantém as branches sincronizadas. Em localhost o GitHub não alcança a API, então os repos só atualizam pelo botão de sync. Para testar o webhook localmente, use um túnel ([smee.io](https://smee.io), ngrok) e passe a URL do túnel em `--api`.

Sirva API e front atrás de um proxy com HTTPS (Caddy, Traefik, nginx). Os volumes `db` e `repos` guardam o banco e os clones.

## GitHub App

Cada instância usa o próprio App, privado. O `setup:github` cria um com:

- Permissões: **Contents** e **Metadata** (somente leitura).
- Callback URL: `<api>/auth/github/callback`.
- Setup URL: `<api>/auth/github/login`, com "Redirect on update".
- Webhook: `<api>/webhooks/github`, evento **Push** (só com API pública).

Para criar o App à mão: GitHub → Settings → Developer settings → GitHub Apps, com os valores acima. Os campos que vão para o `.env` estão descritos em [`service/.env.example`](service/.env.example).

O login usa o OAuth do próprio App. O código lê os repos com tokens de instalação de 1 hora; nenhum token de usuário é guardado.

## Acesso e workspaces

- **Workspace**: projetos, conversas, configurações e instalações do GitHub ficam no workspace. Usuários e workspaces são N:N: uma pessoa pode estar em vários e troca de workspace pelo menu do perfil.
- **`ALLOWED_GITHUB_LOGINS`**: quem pode entrar sem convite e criar workspaces. No primeiro login, cada pessoa da lista ganha um workspace e pode criar outros em **Novo workspace**. Vazia, a instância só aceita quem já foi convidado.
- **Convites**: o dono convida pelo login do GitHub em Configurações, e a pessoa entra no próximo login, sem precisar estar na lista.
- **Instalações**: **Conectar ao GitHub** (só o dono) vincula ao workspace ativo as instalações do App que a sua conta do GitHub enxerga e abre a página de instalação. A mesma instalação pode servir vários workspaces.

Membros veem as respostas sobre todos os repos ligados ao workspace, mesmo os que não acessam diretamente no GitHub. Convide com isso em mente.

## Desenvolvimento

```sh
# API (precisa de Postgres local; DATABASE_URL no service/.env)
cd service && bun install && bun run db:migrate && bun run dev
# Front (VITE_API_URL no app/.env)
cd app && pnpm install && pnpm dev
```

Testes: `cd service && bun test`. Eles gravam no banco do `DATABASE_URL`, então use um banco local.

## Licença

Copyright (C) 2026 gabrielzv11

[GNU AGPL-3.0](LICENSE). Você pode usar, modificar e redistribuir, desde que mantenha os avisos de copyright e publique o código-fonte das suas modificações sob a mesma licença. Isso vale também quando a versão modificada é oferecida como serviço pela rede.
