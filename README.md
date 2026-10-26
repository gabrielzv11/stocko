# stocko

Chat com um agente que lê e explica os repositórios GitHub do seu produto, citando arquivo, linha e commit. Também consulta docs, tickets do Jira e APIs ligados ao projeto, e aponta quando o código diverge do que foi pedido.

Open-source e self-hosted: você roda a instância, cria o próprio GitHub App e usa a sua chave de LLM.

| Pasta                 | O quê                                                                   |
| --------------------- | ----------------------------------------------------------------------- |
| [`service/`](service) | API: Bun + Hono + Prisma (Postgres). Clona os repos e roda o agente.    |
| [`app/`](app)         | Front: React + Vite. Chat, projetos, configurações e painel de uso.     |

## Sumário

- [Como funciona](#como-funciona)
  - [Ferramentas do agente](#ferramentas-do-agente)
  - [Estrutura](#estrutura)
- [Subir com Docker](#subir-com-docker)
  - [Domínio próprio](#domínio-próprio)
- [Configuração](#configuração)
  - [1. GitHub App](#1-github-app)
  - [2. Variáveis de ambiente](#2-variáveis-de-ambiente)
  - [3. Modelo de LLM por workspace](#3-modelo-de-llm-por-workspace)
  - [4. Fontes do projeto: docs, Jira e APIs](#4-fontes-do-projeto-docs-jira-e-apis)
- [Acesso e workspaces](#acesso-e-workspaces)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Desenvolvimento](#desenvolvimento)
- [Limitações conhecidas](#limitações-conhecidas)
- [Próximos passos](#próximos-passos)
- [Licença](#licença)

## Como funciona

1. **Login e workspace** ([service/src/auth.ts](service/src/auth.ts), [service/src/workspaces.ts](service/src/workspaces.ts)) — login pelo OAuth do próprio GitHub App. O token de sessão é opaco, chega ao front no fragmento da URL (`/login#token=`) e o banco guarda só o `sha256`, com validade de 7 dias renovada pelo uso. Tudo (projetos, conversas, instalações, configurações) pertence a um [workspace](#acesso-e-workspaces), e toda consulta é filtrada por ele.
2. **Projetos** ([service/src/projects.ts](service/src/projects.ts)) — um projeto agrupa repositórios que as instalações do App enxergam, mais [docs, Jira e APIs](#4-fontes-do-projeto-docs-jira-e-apis). O mesmo repo pode estar em vários projetos do workspace, com um clone só.
3. **Sincronização** ([service/src/repos.ts](service/src/repos.ts)) — cada repo vira um repositório **bare** em `REPOS_DIR/<id>`, com `fetch --depth=1` por branch observada (até 5, em ordem de prioridade definida na UI). Não há checkout: as ferramentas leem objetos pelo SHA (`ls-tree`, `git grep`, `cat-file`). O sync roda ao criar o projeto, ao adicionar branch, no webhook de `push` e no botão de sync; não há re-sync por tempo. Antes de cada sync, e a cada 10 min durante o chat, o **stocko** confere se o App ainda alcança o repo: um 404 apaga o clone. Commits que saíram das branches observadas (force-push removendo um segredo, por exemplo) são removidos do disco na hora.
4. **Pergunta** ([service/src/chat.ts](service/src/chat.ts)) — a pergunta é salva antes de o agente rodar. O histórico vem do banco, não do cliente. O system prompt lista os projetos, os repos com as branches em ordem, as APIs e as regras de citação; o agente roda até 25 passos com as [ferramentas](#ferramentas-do-agente) e a resposta chega em streaming. O turno termina e é salvo mesmo se o navegador fechar.
5. **Branches em cascata** — a branch de maior prioridade é "o que está no ar" e é a que as ferramentas leem por padrão. As demais são "o que está vindo". Se algo não existe na primeira, o agente procura nas seguintes e diz de onde veio ("não está em `main`, existe em `develop`"). Os SHAs ficam fixos durante o turno, mesmo que um sync termine no meio.
6. **Citações** — código como `owner/repo/caminho#Lx-Ly@sha`, docs como **doc: título § seção**, tickets como link `[CHAVE](url)` e APIs como `api:<título> GET /path`. O front transforma as citações em links e renderiza diagramas `mermaid` que o agente gera para arquitetura, fluxos e modelos de dados.
7. **Conversas longas** ([service/src/summary.ts](service/src/summary.ts)) — quando o contexto do último passo passa de `CONTEXT_SUMMARY_TOKENS`, tudo menos os 2 últimos turnos vira um resumo (em segundo plano, preservando citações, SHAs e números). O título da conversa é gerado pelo modelo no primeiro turno.
8. **Custo e limites** ([service/src/usage.ts](service/src/usage.ts)) — cada resposta grava tokens e custo (o OpenRouter informa o custo em USD). O workspace tem teto de 10 perguntas por minuto e de `MAX_DAILY_COST_USD` nas últimas 24h. A página **Uso** mostra os últimos 30 dias por dia, modelo, projeto e conversa.

Conversas podem ser fixadas, renomeadas, avaliadas (👍/👎 por resposta) e compartilhadas por link público somente leitura, que mostra só o texto das perguntas e respostas: chamadas de ferramenta e o conteúdo bruto lido ficam de fora.

### Ferramentas do agente

| Ferramenta               | Fonte                    | O que faz                                                         | Limite                   |
| ------------------------ | ------------------------ | ----------------------------------------------------------------- | ------------------------ |
| `list_repos`             | banco                    | Repos, branches em ordem, SHA sincronizado e status               | —                        |
| `glob`                   | clone                    | Arquivos por padrão glob                                          | 500 caminhos             |
| `grep`                   | clone / Zoekt            | Regex no conteúdo versionado (`path:linha:texto`)                 | 100 resultados / 16 KB   |
| `read_file`              | clone                    | Arquivo com número de linha, paginado                             | 300 linhas / chamada     |
| `list_commits`           | API do GitHub            | Histórico por path e período                                      | 30 commits               |
| `diff_refs`              | API do GitHub            | Commits, arquivos e patches entre dois refs                       | 16 KB                    |
| `search_docs`            | Postgres (full-text)     | Busca em docs e tickets do Jira                                   | 10 trechos               |
| `read_doc`               | Postgres                 | Texto completo de um trecho                                       | 16 KB                    |
| `search_api`             | spec OpenAPI             | Operações por path, resumo, tag ou `operationId`                  | 50 operações             |
| `describe_api_operation` | spec OpenAPI             | Parâmetros, corpo e respostas com `$ref` resolvido                | 16 KB                    |
| `call_api`               | API cadastrada           | `GET` real (métricas, status, logs)                               | 16 KB, 15 s              |
| `link_projects`          | banco                    | Vincula a conversa aos projetos da pergunta                       | —                        |

As ferramentas de docs só aparecem quando os projetos da pergunta têm docs ou Jira, e as de API só quando têm specs cadastradas. Saída cortada termina com `[truncado — refine o padrão]`, e erros voltam como texto para o modelo corrigir a chamada em vez de derrubar o turno.

`grep` usa `git grep -P` (PCRE) por padrão. Com `GREP_BACKEND=zoekt`, usa um índice de trigramas por repo, com resultados ordenados por relevância (RE2: sem lookaround nem backreference). O Zoekt indexa só a branch do topo; nas outras, e enquanto o repo não tem índice, cai no `git grep`.

### Estrutura

```
docker-compose.yml        Postgres + API + front
service/
  src/
    index.ts              servidor Hono: CORS, limites de corpo, rotas, /health
    env.ts                variáveis de ambiente validadas com zod
    db.ts                 cliente Prisma
    client.ts             Octokit e token de instalação do GitHub App
    auth.ts               OAuth, sessão, requireAuth/requireOwner, vínculo de instalações
    workspaces.ts         workspaces, membros e convites
    projects.ts           projetos, repos, branches observadas e specs de API
    repos.ts              clone bare, sync por branch, checagem de acesso, Zoekt
    webhooks.ts           push e remoção de repos/instalações (HMAC)
    chat.ts               conversas, compartilhamento, feedback e o turno do agente
    agent.ts              ferramentas de código: list_repos, glob, grep, read_file, list_commits, diff_refs
    knowledge.ts          docs e Jira: chunking, sync, busca full-text, search_docs/read_doc
    apis.ts               specs OpenAPI, call_api, proteção contra SSRF, cifragem de segredos
    summary.ts            título e resumo incremental das conversas
    settings.ts           provedor e modelo de LLM do workspace
    usage.ts              custo e tokens dos últimos 30 dias
    *.test.ts             testes (bun test)
  scripts/
    setup-github.ts       cria o GitHub App a partir de um manifest e grava o .env
  prisma/
    schema.prisma         modelo de dados
    migrations/
  Dockerfile              imagem com git e binários do Zoekt
  entrypoint.sh           migra o banco e roda a API sem root
app/
  src/
    features/
      home/               chat, conversa, citações, mermaid, compartilhamento
      projects/           projetos: repos, branches, docs, Jira, APIs
      settings/           workspace, membros, convites, LLM
      usage/              painel de custo
      login/ onboarding/ shared/
    components/ lib/ hooks/
  Dockerfile              build do Vite servido por nginx
```

## Subir com Docker

Requisitos: Docker, [Bun](https://bun.sh) (só para o script de setup) e uma chave do [OpenRouter](https://openrouter.ai/keys).

```sh
cp service/.env.example .env
bun service/scripts/setup-github.ts --api http://localhost:8000
```

O script abre o GitHub com o App já configurado: você só confirma o nome, e ele grava as credenciais no `.env` da raiz. Para criar o App numa organização, use `--org <org>`. O nome precisa ser único no GitHub; troque com `--name "stocko (acme)"`.

No `.env`, preencha também:

- `OPENROUTER_API_KEY`.
- `SECRETS_KEY`: gere com `openssl rand -base64 32`.

Depois:

```sh
docker compose up -d --build
```

Abra http://localhost:5003 e entre com o GitHub. Na primeira vez, escolha **Criar workspace**: em seguida o GitHub abre para você instalar o App nas contas e repos que o agente pode ler.

O compose sobe três serviços: `db` (Postgres 17), `service` (API na porta 8000, aplica as migrations no boot) e `app` (front na porta 5003). Os volumes `db` e `repos` guardam o banco e os clones.

### Domínio próprio

A URL da API entra no bundle do front durante o build, e a URL do front vai para o CORS da API:

```sh
API_URL=https://api.exemplo.com APP_URL=https://stocko.exemplo.com docker compose up -d --build
```

Crie o App com `--api https://api.exemplo.com`. Com a API pública, o script também configura o webhook de push, que mantém as branches sincronizadas. Em localhost o GitHub não alcança a API, então os repos só atualizam pelo botão de sync. Para testar o webhook localmente, use um túnel ([smee.io](https://smee.io), ngrok) e passe a URL do túnel em `--api`.

Sirva API e front atrás de um proxy com HTTPS (Caddy, Traefik, nginx).

## Configuração

### 1. GitHub App

Cada instância usa o próprio App. O [setup-github.ts](service/scripts/setup-github.ts) cria um com:

- Permissões: **Contents** e **Metadata** (somente leitura).
- Callback URL: `<api>/auth/github/callback`.
- Setup URL: `<api>/auth/github/login`, com "Redirect on update".
- Webhook: `<api>/webhooks/github`, evento **Push** (só com API pública).
- Visibilidade: **pública**. Com App privado, o GitHub responde 404 quando outra conta tenta entrar. Ser público só permite que qualquer conta autorize o login e instale o App na própria conta; o acesso aos dados continua por workspace.

Para criar o App à mão: GitHub → Settings → Developer settings → GitHub Apps, com os valores acima, e preencha o bloco `GITHUB_*` da [tabela de variáveis](#2-variáveis-de-ambiente).

O login usa o OAuth do próprio App. O código é lido com tokens de instalação de 1 hora; nenhum token de usuário é guardado. Além de `push`, o webhook trata `installation_repositories.removed` e `installation.deleted`, que apagam os repos e clones correspondentes.

### 2. Variáveis de ambiente

Ficam no `.env` da raiz (Docker) ou em `service/.env` (desenvolvimento). Modelo comentado em [service/.env.example](service/.env.example); validação em [service/src/env.ts](service/src/env.ts) — a API não sobe com valor inválido.

| Nome                      | Obrigatório | Descrição                                                                                                                                         |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | sim         | Postgres. No compose, já definida para o serviço `db`                                                                                             |
| `GITHUB_CLIENT_ID`        | sim         | Client ID do App                                                                                                                                  |
| `GITHUB_CLIENT_SECRET`    | sim         | Client secret do App                                                                                                                              |
| `GITHUB_APP_ID`           | sim         | App ID                                                                                                                                            |
| `GITHUB_APP_SLUG`         | sim         | Slug do link público (`github.com/apps/<slug>`)                                                                                                   |
| `GITHUB_APP_PRIVATE_KEY`  | sim         | Conteúdo do `.pem` (pode ter `\n` escapado). O fingerprint `SHA256:...` no lugar do `.pem` derruba o boot                                         |
| `OPENROUTER_API_KEY`      | sim         | Chave do [OpenRouter](https://openrouter.ai/keys), usada por todos os workspaces que ficam no provedor padrão                                     |
| `GITHUB_WEBHOOK_SECRET`   | não         | Segredo do webhook. Vazio = `/webhooks/github` desligado e repos só atualizam pelo sync manual                                                    |
| `SECRETS_KEY`             | não*        | 32 bytes em base64 (`openssl rand -base64 32`). Cifra o header de auth das APIs, o token do Jira e a chave do Mangaba                             |
| `LLM_MODEL`               | não         | Slug do OpenRouter (padrão `anthropic/claude-sonnet-5.5`). Evite `:free` com código de clientes                                                   |
| `MAX_DAILY_COST_USD`      | não         | Teto de gasto por workspace nas últimas 24h (padrão `5`)                                                                                          |
| `MAX_WORKSPACES_PER_USER` | não         | Workspaces que cada conta pode criar (padrão `3`). O gasto máximo por conta é isto × `MAX_DAILY_COST_USD`                                         |
| `ALLOWED_GITHUB_LOGINS`   | não         | Logins (separados por vírgula) que podem criar workspaces. Vazio = qualquer conta. Todos entram por convite                                       |
| `CONTEXT_SUMMARY_TOKENS`  | não         | Tokens de contexto que disparam o resumo dos turnos antigos (padrão `100000`, ~60% da janela do modelo)                                           |
| `GREP_BACKEND`            | não         | `git` (padrão) ou `zoekt`. Os binários do Zoekt só existem na imagem Docker; sem eles, cai no `git`                                               |
| `MANGABA_BASE_URL`        | não         | Base do [Mangaba Router](https://mangabarouter.store/docs) (padrão `https://mangabarouter.store/v1`)                                              |
| `REPOS_DIR`               | não         | Onde ficam os clones (padrão `./data/repos`; no compose, `/data/repos` no volume `repos`)                                                         |
| `MAX_REPO_SIZE_MB`        | não         | Repos maiores que isso não são clonados (padrão `500`)                                                                                            |
| `FRONTEND_URL`            | não         | URL do front, para CORS e redirects do login (padrão `http://localhost:5003`; no compose, vem de `APP_URL`)                                       |
| `PORT`                    | não         | Porta da API (padrão `8000`)                                                                                                                      |

\* Sem `SECRETS_KEY` a API sobe, mas recusa salvar qualquer segredo: APIs com header de auth, fontes do Jira e chave do Mangaba.

No front (`app/.env`, ou build arg no Docker): `VITE_API_URL`, a URL pública da API.

### 3. Modelo de LLM por workspace

Em **Configurações**, o dono escolhe o provedor e o modelo do workspace ([service/src/settings.ts](service/src/settings.ts)):

- **OpenRouter** (padrão): usa a `OPENROUTER_API_KEY` do servidor. Modelo vazio = `LLM_MODEL`. O custo de cada resposta entra no teto diário e no painel de uso.
- **Mangaba Router**: usa a chave `mr-...` do próprio workspace, validada ao salvar e guardada cifrada (precisa de `SECRETS_KEY`). Modelo padrão `mangaba-titan` (192k de contexto e tool calling; os outros modelos do Mangaba têm 8k–64k, pouco para o agente).

### 4. Fontes do projeto: docs, Jira e APIs

O código diz o que **é**; docs e tickets dizem o que **deveria ser**. Em perguntas sobre regra ou comportamento, o agente consulta os dois e, se divergirem, aponta a divergência com as duas citações, sem escolher lado.

- **Docs** ([service/src/knowledge.ts](service/src/knowledge.ts)) — texto ou Markdown de até 2 MB, colado na página do projeto. É dividido por seção (títulos `#` a `###`, fora de blocos de código) e indexado no Postgres com busca full-text em português. Sem embeddings e sem custo extra.
- **Jira** — URL do Jira Cloud, e-mail, API token e uma JQL. Só o dono cadastra, porque o token lê tickets nas perguntas de todos os membros. Os tickets (até 2000) são importados em segundo plano e relidos quando uma pergunta usa a fonte e a última leitura tem mais de 30 min, ou pelo botão de sync.
- **APIs** ([service/src/apis.ts](service/src/apis.ts)) — spec OpenAPI 3 ou Swagger 2 (JSON ou YAML, até 10 MB) com título, descrição e instruções de uso, que o agente segue para decidir quando consultá-la. Com `baseUrl`, o agente pode fazer `GET` de verdade (ex.: Prometheus, status de pods, logs) e cruzar com o código em perguntas como "por que está lento?". Sem `baseUrl`, a spec serve só como documentação. O header de auth (`Header: valor`) é opcional e só o dono cadastra.

## Acesso e workspaces

- **Workspace**: projetos, conversas, configurações e instalações do GitHub ficam no workspace. Usuários e workspaces são N:N: uma pessoa pode estar em vários e troca de workspace pelo menu do perfil.
- **Login**: qualquer conta do GitHub entra. Sem workspace, a pessoa vê duas opções: **Criar workspace** ou **Entrar com convite**. A mesma tela aparece em **Criar ou entrar em workspace**, no menu do perfil.
- **Convites**: em Configurações, o dono gera um link (`<app>/invite/<código>`). Quem abrir o link, ou colar o link ou o código na tela inicial, entra como membro. O link vale por 7 dias, serve para várias pessoas e pode ser revogado a qualquer momento. Remover um membro corta o acesso na hora.
- **`ALLOWED_GITHUB_LOGINS`** (opcional): se preenchida, só esses logins criam workspaces; os demais entram apenas por convite. Vazia, qualquer conta cria. Numa instância pública, preencha: cada workspace gasta da sua chave de LLM, até `MAX_DAILY_COST_USD` por dia, e cada conta cria até `MAX_WORKSPACES_PER_USER` (padrão 3).
- **Instalações**: **Conectar ao GitHub** (só o dono) vincula ao workspace ativo as instalações do App que a sua conta do GitHub enxerga **por inteiro** e abre a página de instalação. Uma instalação da qual a conta só vê parte dos repos não é vinculada, para o workspace não ganhar repos privados que o dono não lê. A mesma instalação pode servir vários workspaces.
- **Papéis**: só o dono renomeia o workspace, gerencia membros e convites, troca o LLM, apaga projetos e cadastra credenciais (header de API, token do Jira). Membros criam projetos, adicionam repos, docs e APIs sem credencial, e conversam.

Membros veem as respostas sobre todos os repos ligados ao workspace, mesmo os que não acessam diretamente no GitHub. Convide com isso em mente.

## Segurança e privacidade

- **O código vai para o provedor de LLM.** Trechos lidos pelo agente (arquivos, diffs, resultados de busca, respostas de API, docs e tickets) são enviados ao OpenRouter e ao modelo escolhido, ou ao Mangaba Router. Confira a política de dados do provedor e se o contrato ou NDA dos repositórios de clientes permite isso. Evite modelos `:free`, que podem registrar ou treinar com o conteúdo.
- **Membros veem tudo do workspace.** Ver [Acesso e workspaces](#acesso-e-workspaces). O acesso ao código é do App, não de cada pessoa.
- **Links compartilhados são públicos.** Qualquer pessoa com o link lê a conversa, inclusive trechos de código citados nas respostas. Revogue em **Compartilhar** quando não precisar mais; apagar a conversa também derruba o link.
- **Agente só lê.** As ferramentas de código leem objetos do repo pelo SHA (`../`, caminhos absolutos e symlinks não alcançam o disco do servidor), e `call_api` só faz `GET`. Uma instrução maliciosa escondida em código, doc, ticket ou resposta de API não consegue alterar nada com as credenciais cadastradas. Cada `call_api` gera uma linha de auditoria no log (`[call_api]`), inclusive as bloqueadas.
- **SSRF.** `baseUrl` das APIs e URL do Jira precisam resolver para IP público; redes privadas, loopback, link-local e afins são recusados, e redirects não são seguidos.
- **Segredos cifrados.** Header de auth das APIs, token do Jira e chave do Mangaba são gravados com AES-256-GCM usando `SECRETS_KEY` e nunca voltam para o front. Perder a `SECRETS_KEY` torna esses segredos ilegíveis: guarde-a junto com o backup do banco.
- **Front sem HTML bruto.** O Markdown do agente é renderizado sem HTML (e os diagramas `mermaid` com `securityLevel: 'strict'`), para que uma injeção vinda do código não vire XSS e roube o token de sessão.
- **Webhook assinado.** `/webhooks/github` valida o `X-Hub-Signature-256` (HMAC) sobre o corpo bruto.
- **Container sem root.** O [entrypoint](service/entrypoint.sh) só usa root para ajustar o dono do volume dos clones e depois roda git, Zoekt e a API como o usuário `bun`.
- **Instância pública.** Preencha `ALLOWED_GITHUB_LOGINS` e ajuste `MAX_DAILY_COST_USD` e `MAX_WORKSPACES_PER_USER`: qualquer conta do GitHub pode entrar e, sem a lista, criar workspaces que gastam da sua chave do OpenRouter.

## Desenvolvimento

```sh
# API (precisa de Postgres local; DATABASE_URL no service/.env)
cd service && bun install && bun run db:migrate && bun run dev
# Front (VITE_API_URL no app/.env)
cd app && pnpm install && pnpm dev
```

Para criar um App de desenvolvimento, rode `bun run setup:github --api http://localhost:8000` dentro de `service/`: as credenciais vão para `service/.env`.

```sh
cd service
bun run typecheck
bun test
```

Os testes gravam no banco do `DATABASE_URL`, então use um banco local.

## Limitações conhecidas

**Repositórios**

- **Clone raso.** Cada branch tem só o último commit em disco; histórico (`list_commits`, `diff_refs`) vem da API do GitHub e conta no limite de requisições da instalação.
- **Até 5 branches por repo** e repos de até `MAX_REPO_SIZE_MB`. Branch fora da lista observada não é lida.
- **Atualização depende do webhook.** Sem API pública (ou sem `GITHUB_WEBHOOK_SECRET`), os repos só mudam pelo botão de sync.
- **Instalação conferida só no vínculo.** Repos adicionados depois a uma instalação já vinculada não passam de novo pela checagem de "a conta do dono vê todos".
- **Zoekt só na branch do topo.** Busca com `ref` em outra branch usa `git grep`.

**Respostas e custo**

- **Teto diário aproximado.** O custo só é somado no fim do turno; perguntas simultâneas podem passar um pouco de `MAX_DAILY_COST_USD`. Título e resumo da conversa não entram no teto nem no painel de uso.
- **Custo só do OpenRouter.** Com Mangaba, tokens são registrados mas o custo não, e o teto diário não se aplica.
- **Busca de docs por palavra-chave.** Full-text em português, sem embeddings: paráfrases sem palavras em comum podem não ser encontradas. Sem índice, fica lenta acima de algumas dezenas de milhares de trechos.
- **Jira Cloud apenas** (API v3 com e-mail e token), até 2000 tickets por fonte.

**Execução**

- **Uma réplica.** Fila de sync, deduplicação e resumo de conversas rodam em memória no processo. Várias réplicas da API sincronizariam o mesmo repo em paralelo.
- **Lista de conversas** mostra as 100 mais recentes, sem paginação.
- **`SECRETS_KEY` sem rotação.** Trocar a chave exige recadastrar os segredos.

## Próximos passos

- Conjunto de perguntas de avaliação (`evals/`) para comparar modelos por recall de citação, passos e custo.
- Embeddings (pgvector) na busca de docs, se a busca por palavra-chave começar a perder paráfrases.
- Fila externa para sync e resumo, permitindo mais de uma réplica.
- Observabilidade das chamadas de LLM.

## Licença

Copyright (C) 2026 gabrielzv11

[GNU AGPL-3.0](LICENSE). Você pode usar, modificar e redistribuir, desde que mantenha os avisos de copyright e publique o código-fonte das suas modificações sob a mesma licença. Isso vale também quando a versão modificada é oferecida como serviço pela rede.
