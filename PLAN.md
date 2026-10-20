# stocko-service — Plano do MVP

Backend do Stocko: agrega fontes de um produto de software (inicialmente repositórios GitHub) e responde perguntas via chat com um agente LLM.

Arquitetura de busca híbrida:
- **Código → busca agêntica** (grep/glob/read sobre clones locais).
- **Docs/Jira/infra → RAG** (fase 2), exposto ao agente como mais uma ferramenta (`search_docs`). O agente decide quando usar cada uma.

## Stack

| Camada | Escolha |
|---|---|
| Runtime | Bun (versões fixadas; smoke test Prisma no CI) |
| HTTP | Hono |
| Banco | Postgres + Prisma; pgvector habilitado (sem uso no MVP) |
| LLM | OpenRouter via Vercel AI SDK (`ai` + `@openrouter/ai-sdk-provider`), modelo em `LLM_MODEL` |
| Jobs | Inngest (modo `connect`) |
| GitHub | GitHub App (login + token de instalação + webhooks) |
| Deploy | Railway, 1 réplica, volume em `/data/repos` |

## Domínio

```
User 1─N Identity { provider:'github', subject }
User N─N Workspace (Member)                 — workspace criado no signup, sem convites no MVP
Session { tokenHash, userId, expiresAt }    — token opaco Bearer

Workspace 1─N Installation { githubInstallationId }
Workspace 1─N Repository { installationId, githubRepoId, fullName, defaultBranch }   — 1 clone
Repository 1─N RepoBranch { name, priority, status, lastSyncedSha, error }           — até 5

Workspace 1─N Project
Project N─N Repository via ProjectSource { type:'github_repo'|'doc'|'jira', repositoryId?, config jsonb }

Project 1─N Conversation { title, pinned, summary, summarizedUntilMessageId }
Conversation 1─N Message { role, parts jsonb }

(fase 2) Chunk { sourceId, content, embedding vector, metadata }
```

## Repositórios e branches

- Clone em `/data/repos/<repoId>/.git`, `git worktree` por branch em `wt/<slug>`, `fetch --depth=1`.
- Branches observadas definidas pelo usuário (máx. 5/repo), **ordenadas por prioridade** (drag + ↑↓ na UI).
- **Cascata**: ref padrão das tools = branch `ready` de maior prioridade. Se algo não existe na de topo, o agente busca na próxima e informa a branch ("não está em `main`, existe em `develop`").
- Histórico (`list_commits`) via API GitHub — o clone raso não tem histórico.
- Branch deletada no GitHub → `status=error`, aviso no front, source mantida.
- Citações usam `lastSyncedSha` (links estáveis).

## Sync (Inngest)

- `repo/branch.sync.requested { repoId, branch }`: concorrência 1 por repo, debounce 30s por branch, retry nativo.
- Webhook `push` (HMAC validado na nossa rota) → evento. Só branches observadas.
- Webhook `installation_repositories.removed` → remove repo/clone.
- Cron `*/30 * * * *`: reconcilia SHA remoto × `lastSyncedSha`.
- Lock RW em memória entre sync e tools do agente.
- No boot: branches `syncing` → `pending`.
- Limite de tamanho por repo (`MAX_REPO_SIZE_MB`).

## Agente

Tools (todas com `ref?`, sandbox de path com `realpath` + `startsWith(repoRoot)`):

| Tool | Limite de saída |
|---|---|
| `list_repos()` | — |
| `glob(repo, pattern, ref?)` | 500 paths |
| `grep(repo, regex, glob?, ref?)` | 100 matches / 16 KB |
| `read_file(repo, path, start?, end?, ref?)` | 300 linhas/chamada |
| `diff_refs(repo, base, head, path?)` | 16 KB |
| `list_commits(repo, path?, ref?)` | 30 commits (API) |
| `search_docs(query)` | fase 2 |

Saída truncada sempre com aviso `[truncado — refine o padrão]`.

System prompt (estável, primeiro, cacheável): projeto, repos, branches `ready` em ordem de prioridade, regras de citação `repo/path#Lx-Ly@sha`, regras de precedência:
1. Branch de maior prioridade = verdade do "o que está no ar".
2. Demais branches = "o que está vindo"; sempre dizer de qual branch veio.
3. (fase 2) Docs/Jira = "o que deveria ser"; divergência com o código é reportada com ambas citações, sem escolher lado.

Contexto:
- `MAX_STEPS=25`.
- Resumo incremental quando `usage.inputTokens` > `CONTEXT_SUMMARY_THRESHOLD` (60% da janela): resume tudo exceto os 2 últimos turnos em `Conversation.summary`, preservando conclusões e citações. Roda após o turno via evento Inngest `conversation/summarize.requested` (concorrência 1 por conversa).
- Montagem: system → `<conversation_summary>` → 2 últimos turnos completos → pergunta.
- `Message.parts` completo persistido para UI.
- Título da conversa gerado por chamada barata na primeira pergunta.

## Auth e segurança

- Login "Entrar com GitHub" (OAuth do GitHub App), `state` no banco.
- Token opaco (32 bytes) entregue em `app/login#token=` (fragment), armazenado no localStorage do front, enviado como `Authorization: Bearer`. Banco guarda só `sha256`. TTL 7 dias deslizante.
- Allowlist `ALLOWED_GITHUB_LOGINS`.
- `requireAuth` único; futuro: ramo para JWT do host (Module Federation).
- Instalação do App: cada login vincula ao workspace as instalações de `GET /user/installations` (token do usuário); `installation_id` da URL é ignorado.
- Toda query filtrada por `workspaceId` (anti-IDOR).
- Webhook com HMAC (`X-Hub-Signature-256`) sobre o raw body.
- Front: markdown do agente renderizado **sem HTML bruto** (prompt injection via código → XSS → roubo de token).
- Limites: `MAX_STEPS`, `MAX_REPOS_PER_WORKSPACE`, `MAX_REPO_SIZE_MB`, teto de gasto no OpenRouter.
- Evitar modelos `:free` com código de clientes (podem logar/treinar).

## API

```
GET    /health
GET    /auth/github/login
GET    /auth/github/callback
POST   /auth/logout
GET    /me

GET    /github/install                — redireciona p/ instalar o App; Setup URL volta em /auth/github/login
GET    /github/repos
POST   /webhooks/github

POST   /repositories
GET    /repositories/:id
GET    /repositories/:id/remote-branches
POST   /repositories/:id/branches
DELETE /repositories/:id/branches/:bid
PUT    /repositories/:id/branches/order
POST   /repositories/:id/sync

GET    /projects
POST   /projects
PATCH  /projects/:id
DELETE /projects/:id
POST   /projects/:id/sources
DELETE /projects/:id/sources/:sid

GET    /conversations?pinned=&limit=
GET    /projects/:id/conversations
POST   /projects/:id/conversations
GET    /conversations/:id
POST   /conversations/:id/messages     — stream (AI SDK UI message stream / useChat)
PATCH  /conversations/:id              — { title?, pinned? }
DELETE /conversations/:id

/api/inngest
```

## Qualidade

- `evals/questions.json` (~10 perguntas com `expectFiles`) + `bun run eval --model=<id>`: recall de citação, passos, tokens/custo, falhas de tool call. Escolher o modelo mais barato com ≥ 8/10.
- `bun test` obrigatório do sandbox de path (`../`, absoluto, symlink, repo de outro workspace).

## Fora do MVP

RAG/docs/Jira/infra · convites e pin por usuário · fetch efêmero de branch arbitrária · múltiplas réplicas · observabilidade de LLM (Langfuse) · client tipado no front (`hc`) · cookie de sessão com domínio próprio.

## Ordem de implementação

1. Scaffold: Hono + Bun, Prisma schema, env, Dockerfile, `/health`.
2. Auth GitHub + sessão + allowlist + `requireAuth`.
3. Instalação do App + `/github/repos` + `Repository`/`RepoBranch`.
4. Sync git (Inngest) + webhooks + reconciliação.
5. Tools do agente + sandbox + teste.
6. Chat streaming + persistência + título.
7. Resumo incremental.
8. Projetos/sources/conversas CRUD.
9. Eval e escolha do modelo.
10. Front: integrar API, `useChat`, UI de branches.
