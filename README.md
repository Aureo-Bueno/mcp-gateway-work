# MCP Gateway

Gateway em TypeScript que fica na frente de vários servidores [MCP](https://modelcontextprotocol.io) e os apresenta ao cliente como **um único servidor MCP**. Ele aplica autenticação, autorização por perfil, limite de requisições, auditoria, métricas e **aprovação humana** para ferramentas perigosas.

```
Cliente MCP (Claude, agente, IDE)
        │  Streamable HTTP  (POST /mcp)
        ▼
┌────────────────────────────────────────────┐
│  MCP GATEWAY (Express + TypeScript)        │
│  auth → RBAC → rate limit → aprovação →    │
│  router → registry · redação · audit ·     │
│  métricas                                  │
└───────┬───────────────────────┬────────────┘
        │ stdio                 │ HTTP
        ▼                       ▼
  Servidor MCP A          Servidor MCP B
```

Para o cliente, o gateway parece um único servidor. Para cada servidor real, ele é um cliente MCP: mantém uma sessão aberta, junta todas as ferramentas em um catálogo único e usa prefixo (`github__create_issue`) para evitar conflito de nomes.

## Funcionalidades

- **Agregação** de servidores MCP `stdio` e `HTTP` em um só endpoint, com nomes prefixados por servidor.
- **API keys** guardadas apenas como hash (SHA-256), com prefixo visível e revogação.
- **Perfis e RBAC**: cada perfil tem padrões de ferramentas permitidas (ex.: `github__list_*`).
- **Rate limit** por cliente, com armazenamento em Redis.
- **Audit log** de cada chamada (cliente, ferramenta, parâmetros, latência, status).
- **Métricas Prometheus** em `/metrics` e em JSON na API admin.
- **API administrativa** e **painel web** para gerenciar servidores, chaves, usuários, perfis, auditoria e aprovações.
- **Aprovação humana** (fase 6): chamadas que casam com uma regra ficam pausadas até alguém aprovar ou recusar no painel.
- **Mascaramento de segredos** (fase 7): respostas das ferramentas são varridas e valores sensíveis (API keys, tokens, CPF, cartão) são substituídos por `***` antes de chegar ao modelo e ao audit log.
- **Proxy de `resources` e `prompts`**: além de ferramentas, o gateway agrega os resources (estáticos e templates) e os prompts dos upstreams, com `resources/read`, `resources/templates/list` e `prompts/get` roteados para o servidor de origem.
- **Monitor de saúde dos upstreams**: ping periódico de cada servidor, com status/latência expostos na API admin e em métricas Prometheus.
- **Cache de ferramentas de leitura**: resultados de ferramentas com nome "read-only" (`get_*`, `list_*`, `read_*`, `search_*`, ...) são cacheados por TTL para evitar idas repetidas ao upstream.
- **Persistência em PostgreSQL** via drizzle-orm; servidores cadastrados sobrevivem a reinícios.

## Stack

| Camada | Escolha |
| --- | --- |
| Protocolo MCP | `@modelcontextprotocol/sdk` |
| HTTP | `express` |
| Validação | `zod` |
| Banco | PostgreSQL com `drizzle-orm` e `pg` |
| Cache / rate limit | Redis com `rate-limiter-flexible` |
| Logs | `pino` |
| Métricas | `prom-client` |
| Docs | `swagger-ui-express` |
| Testes | `jest` + `@swc/jest` + `supertest` |
| Build / dev | `tsup`, `tsx`, `eslint`, `prettier` |

## Requisitos

- Node.js 20+ (o projeto usa `process.loadEnvFile`).
- PostgreSQL e Redis (localmente via Docker ou instâncias próprias).

## Como rodar (desenvolvimento)

```bash
# 1. dependências
npm install

# 2. suba Postgres e Redis
npm run db:up
npm run redis:up

# 3. variáveis de ambiente (o .env do repositório já traz defaults locais)
#    ajuste DATABASE_URL/REDIS_URL se usar instâncias próprias

# 4. crie o schema e popule users/perfis/chaves/regras
npm run db:migrate
npm run db:seed

# 5. suba o gateway
npm run dev
```

No primeiro `db:seed` são impressas as **API keys** (admin, developer, readonly) — guarde-as, pois só aparecem uma vez. O gateway fica em `http://localhost:3000`.

## Como rodar (Docker)

O `docker-compose.yml` sobe Postgres, Redis, um container de migração e o gateway. As migrações rodam **antes** do gateway (o container `migrate` precisa terminar com sucesso).

```bash
npm run docker:up          # docker compose up -d --build
npm run docker:logs        # acompanha os logs do gateway
npm run docker:down
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP do gateway |
| `DATABASE_URL` | `postgres://mcp:mcp@localhost:5432/mcp_gateway` | Conexão PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379` | Conexão Redis (rate limit) |
| `GATEWAY_CONFIG` | `gateway.config.json` | Arquivo com os servidores iniciais |
| `LOG_LEVEL` | `info` | Nível de log do pino (`debug`/`info`/`warn`/`error`) |
| `RATE_LIMIT_POINTS` | `100` | Requisições permitidas por janela |
| `RATE_LIMIT_DURATION` | `60` | Tamanho da janela, em segundos |
| `APPROVAL_TIMEOUT_SECONDS` | `120` | Tempo que uma chamada aguarda aprovação antes de expirar |
| `CORS_ORIGIN` | `*` | Origem permitida para CORS (ex.: `http://localhost:5173`) |
| `REDACTION_ENABLED` | `true` | Liga/desliga o mascaramento de segredos nas respostas |
| `REDACTION_REPLACEMENT` | `***` | Texto que substitui cada valor sensível |
| `HEALTH_CHECK_INTERVAL_SECONDS` | `30` | Intervalo entre os pings de saúde dos upstreams |
| `READ_CACHE_ENABLED` | `true` | Liga/desliga o cache de ferramentas de leitura |
| `READ_CACHE_TTL_SECONDS` | `30` | Tempo de vida de cada entrada do cache de leitura |
| `READ_CACHE_MAX_ENTRIES` | `500` | Número máximo de entradas mantidas no cache (evicção FIFO) |

### Formato do `gateway.config.json`

```json
{
  "servers": [
    {
      "name": "echo",
      "type": "stdio",
      "command": "./node_modules/.bin/tsx",
      "args": ["tests/fixtures/echo-server.ts"]
    }
  ]
}
```

O arquivo só é usado para popular a tabela `servers` quando ela está **vazia**. Depois disso, o banco é a fonte da verdade e você pode adicionar/remover servidores pelo painel ou pela API admin, sem reiniciar.

### Registrar um servidor (painel e API)

O gateway suporta dois tipos de servidor, e cada tipo usa campos diferentes:

**`stdio`** — o gateway **inicia um processo** e conversa com ele por stdin/stdout.

| Campo | O que é | Exemplo |
| --- | --- | --- |
| `name` | Nome do servidor. Vira prefixo das ferramentas (`filesystem__read_file`). | `filesystem` |
| `command` | Programa que será executado. | `npx`, `node`, `python` |
| `args` | Argumentos do programa (lista). Aceita aspas para valores com espaço. | `["-y", "@modelcontextprotocol/server-filesystem", "/home/rafael"]` |
| `env` | Variáveis de ambiente do processo (opcional), `KEY=VALUE`. É aqui que ficam tokens/segredos que o servidor precisa. | `GITHUB_TOKEN=ghp_xxx` |

**`http`** — o gateway **conecta a um servidor MCP remoto** (Streamable HTTP). Não inicia processo, então não tem `command`/`args`/`env`.

| Campo | O que é | Exemplo |
| --- | --- | --- |
| `name` | Igual ao acima. | `github` |
| `url` | URL do endpoint MCP. | `http://host:8080/mcp` |
| `headers` | Cabeçalhos enviados em toda requisição (opcional), `KEY=VALUE`. Equivale ao `env` do stdio: aqui vai a autenticação. | `Authorization=Bearer ghp_xxx` |

Exemplos de corpo para `POST /admin/servers`:

```json
{ "name": "filesystem", "type": "stdio", "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/rafael"],
  "env": { "GITHUB_TOKEN": "ghp_xxx" } }
```

```json
{ "name": "github", "type": "http", "url": "http://host:8080/mcp",
  "headers": { "Authorization": "Bearer ghp_xxx" } }
```

No painel, escolha o **Type** e o formulário mostra só os campos daquele tipo.

## Endpoints

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| POST | `/mcp` | API key | Endpoint MCP (JSON-RPC: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`) |
| GET | `/health` | — | Healthcheck |
| GET | `/docs` | — | Swagger UI |
| GET | `/openapi.json` | — | Especificação OpenAPI |
| GET | `/panel` | — | Painel web (a chave admin é digitada na tela) |
| GET | `/metrics` | admin | Métricas no formato Prometheus |

### API administrativa (`/admin`, exige API key de perfil admin)

- `GET /admin/servers`, `POST /admin/servers`, `DELETE /admin/servers/:name`
- `POST /admin/servers/:name/refresh` (recarrega a lista de ferramentas), `POST /admin/servers/:name/ping` (testa a conexão, retorna `{ ok, latencyMs }`)
- `GET /admin/catalog`
- `GET /admin/health` (último status de saúde de cada upstream), `POST /admin/health/check` (dispara uma verificação agora e retorna o resumo)
- `GET /admin/audit`
- `GET /admin/metrics` (JSON)
- `GET /admin/api-keys`, `POST /admin/api-keys`, `DELETE /admin/api-keys/:id`
- `GET /admin/users`, `POST /admin/users`
- `GET /admin/profiles`, `POST /admin/profiles`, `PUT /admin/profiles/:name/tools`
- `GET /admin/approvals`, `POST /admin/approvals/:id/approve`, `POST /admin/approvals/:id/reject`
- `GET /admin/approval-rules`, `POST /admin/approval-rules`, `DELETE /admin/approval-rules/:id`

## Autenticação

Clientes enviam a API key no header `x-api-key`. A chave é comparada pelo hash e resolve um usuário + perfil; o perfil define quais ferramentas aparecem em `tools/list` e podem ser chamadas. Chaves revogadas retornam `401`.

## Aprovação humana de ferramentas perigosas (fase 6)

Regras de aprovação são padrões de nome de ferramenta (mesma sintaxe do RBAC, com `*`). O seed cria regras padrão para operações destrutivas, por exemplo:

```
*__delete_*   *__delete   *__remove_*   *__drop_*
*__create_*   *__update_*  *__write_*    *__execute_*   *__send_*
```

Fluxo de uma chamada:

1. O cliente chama `tools/call` de uma ferramenta que casa com uma regra ativa.
2. Em vez de executar, o gateway cria um **pedido de aprovação** pendente e a requisição fica **pausada**.
3. Alguém aprova ou recusa no painel (`/panel`, aba **Approvals**) ou via `POST /admin/approvals/:id/approve|reject`.
4. Se aprovado, a ferramenta é executada e o resultado volta ao cliente. Se recusado ou se o tempo (`APPROVAL_TIMEOUT_SECONDS`) esgotar, o cliente recebe um erro JSON-RPC `-32004`.

**Demo rápida**: adicione a regra `echo__echo` na aba *Approvals*, chame a ferramenta `echo__echo` (a chamada trava), clique em **Approve** e veja o resultado chegar.

## Mascaramento de segredos (fase 7)

Antes de uma resposta de ferramenta chegar ao modelo (e de ser gravada no audit log), o gateway varre todos os campos de texto e substitui valores sensíveis por `***`. Isso evita que segredos vazem para o histórico do modelo, para os logs ou para o banco.

Padrões detectados por padrão:

```
sk-...            OpenAI/Anthropic keys     gh[pousr]_...   GitHub tokens
xox[baprs]-...    Slack tokens              AKIA...         AWS access keys
AIza...           Google API keys           eyJ....         JWTs
Bearer <token>    preserva o esquema        api_key=...     valor após a chave
123.456.789-00    CPF                       4111 1111 ...   cartão de crédito
```

Funciona em toda a resposta (inclusive `structuredContent` e arrays), é configurável por env (`REDACTION_ENABLED`, `REDACTION_REPLACEMENT`) e gera a métrica `mcp_gateway_tool_redactions_total{rule}`.

**Demo**: o servidor `echo` de exemplo tem a ferramenta `echo__leak`, que devolve texto com segredos falsos. Chame `echo__leak` e veja a resposta mascarada:

```bash
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: SUA_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo__leak","arguments":{}}}'
# → o texto retorna com "***" no lugar da key, do CPF e do cartão
```

## Proxy de `resources` e `prompts` (fase 8)

Além das ferramentas, o gateway agrega os **resources** e **prompts** dos upstreams. No `initialize` ele anuncia `tools`, `resources` e `prompts`; os métodos são roteados para o servidor de origem.

| Método MCP | O que faz |
| --- | --- |
| `resources/list` | Lista os resources estáticos de todos os upstreams |
| `resources/templates/list` | Lista os templates de URI (resources dinâmicos) |
| `resources/read` | Lê um resource pelo URI exposto |
| `prompts/list` | Lista os prompts, prefixados por servidor (`echo__greet`) |
| `prompts/get` | Resolve um prompt com argumentos |

**Namespacing de URIs**: como dois servidores podem expor o mesmo URI, todo resource é exposto sob o esquema `mcp-gateway://<servidor>/<uri-original>`. Ex.: o resource `echo://greeting` do servidor `echo` aparece como `mcp-gateway://echo/echo://greeting`. O gateway remove o prefixo e encaminha o URI original ao upstream — funciona para resources estáticos e para URIs construídos a partir de um template (`mcp-gateway://echo/echo://files/{path}`).

O conteúdo lido também passa pelo **mascaramento de segredos**. Prompts seguem a mesma convenção de prefixo das ferramentas (`servidor__nome`).

```bash
# resources
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: SUA_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}'
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: SUA_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"mcp-gateway://echo/echo://greeting"}}'

# prompts
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: SUA_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list"}'
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: SUA_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"echo__greet","arguments":{"name":"Rafael"}}}'
```

O servidor `echo` de exemplo registra os resources `echo://greeting`, `echo://leaky-doc` e o template `echo://files/{path}`, além do prompt `greet`.

## Monitor de saúde dos upstreams (fase 8)

Um monitor em background pinga cada servidor registrado a cada `HEALTH_CHECK_INTERVAL_SECONDS` segundos e guarda o último resultado (status, latência, horário).

- A lista `GET /admin/servers` ganha os campos `healthy`, `lastPingMs` e `lastCheckAt` (a coluna **Health** no painel).
- `GET /admin/health` retorna o último status de cada upstream.
- Métricas: `mcp_gateway_upstream_healthy{server}` (gauge 0/1), `mcp_gateway_upstream_ping_duration_seconds{server}` e `mcp_gateway_upstream_ping_failures_total{server}`.

Servidores que não estão mais registrados têm o estado de saúde removido automaticamente na próxima verificação.

## Cache de ferramentas de leitura (fase 8)

Chamadas a ferramentas com nome "read-only" são cacheadas por `READ_CACHE_TTL_SECONDS` para evitar idas repetidas ao upstream. A heurística considera nomes que começam com `get`, `list`, `read`, `search`, `fetch`, `find`, `query`, `describe`, `show`, `lookup`, `stat`, `info`, `status` ou `head` (ex.: `echo__get_counter`).

- A chave é `servidor:ferramenta:argumentos` (argumentos serializados de forma estável, independente da ordem das chaves).
- Só respostas bem-sucedidas são cacheadas; o valor guardado já passou pelo mascaramento de segredos.
- O cache é invalidado por servidor ao dar `refresh`, registrar ou remover um servidor, além do TTL.
- Métrica: `mcp_gateway_tool_cache_total{server,result}` (`hit`/`miss`).
- Controle por env: `READ_CACHE_ENABLED`, `READ_CACHE_TTL_SECONDS`, `READ_CACHE_MAX_ENTRIES`.

## Testes

```bash
npm test            # jest
npm run test:watch
npm run typecheck   # tsc --noEmit
```

A pasta `tests/` espelha a estrutura de `src/`. Os testes que tocam o banco (ex.: `tests/services/approvals.test.ts`) precisam do PostgreSQL no ar (`npm run db:up`) e das migrações aplicadas.

## Estrutura do projeto

```
src/
├── index.ts              # sobe o Express, conecta upstreams e DB
├── config/
│   ├── env.ts            # env validado com zod
│   └── servers.ts        # tipos/validação de servidores
├── http/
│   ├── app.ts            # monta middlewares e rotas
│   ├── mcpRoute.ts       # POST /mcp (entrada dos clientes)
│   ├── adminRoutes.ts    # API administrativa
│   ├── jsonrpc.ts        # schemas e helpers JSON-RPC
│   ├── openapi.ts        # especificação OpenAPI
│   └── panel.ts          # painel web (HTML)
├── middleware/
│   ├── auth.ts · adminAuth.ts · rbac.ts · rateLimit.ts · errorHandler.ts
├── gateway/
│   ├── registry.ts · catalog.ts · router.ts · healthMonitor.ts
│   └── upstream/{stdioClient.ts,httpClient.ts}
├── services/
│   ├── access.ts · credentials.ts · apiKeys.ts
│   ├── approvals.ts      # regras + fila de aprovação humana
│   ├── redaction.ts      # mascaramento de segredos nas respostas
│   ├── readCache.ts      # cache de ferramentas de leitura
│   ├── health.ts         # último status de saúde dos upstreams
│   ├── auditLog.ts · metrics.ts · rateLimiter.ts · serverStore.ts
├── db/
│   ├── schema.ts · client.ts · migrate.ts · seed.ts
└── types/
tests/                    # espelha src/
migrations/               # SQL gerado pelo drizzle-kit
```

## Scripts úteis

| Script | O que faz |
| --- | --- |
| `npm run dev` | Roda o gateway com `tsx` (sem build) |
| `npm run build` | Build de produção com `tsup` |
| `npm start` | Roda o build (`node dist/index.js`) |
| `npm run db:generate` | Gera uma migração a partir do schema |
| `npm run db:migrate` | Aplica as migrações |
| `npm run db:seed` | Popula perfis, usuários, chaves e regras padrão |
| `npm test` | Testes com jest |
| `npm run docker:up` / `docker:down` | Sobe/derruba a stack completa |

## Licença

MIT
