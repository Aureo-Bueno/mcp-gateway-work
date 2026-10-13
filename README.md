# MCP Gateway

**Português** · [English](README.en.md)

Gateway em TypeScript que fica na frente de vários servidores [MCP](https://modelcontextprotocol.io) e os apresenta ao cliente como **um único servidor MCP**. Ele aplica autenticação, autorização por perfil, limite de requisições, auditoria, métricas e **aprovação humana** para ferramentas perigosas.

```
Cliente MCP (Claude, agente, IDE)
        │  HTTP + JSON-RPC  (POST /mcp)
        ▼
┌────────────────────────────────────────────┐
│  MCP GATEWAY (Express + TypeScript)        │
│  auth → rate limit → RBAC → aprovação →    │
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
- **Perfis e RBAC**: cada perfil tem padrões de ferramentas permitidas (ex.: `github__list_*`). O controle vale para `tools/list` e `tools/call`; ferramenta proibida devolve o erro JSON-RPC `-32003`.
- **Rate limit** por usuário, com armazenamento em Redis e fallback em memória se o Redis cair.
- **Audit log** de chamadas a ferramentas, `resources/read` e `prompts/get`, inclusive as proibidas, desconhecidas, recusadas, expiradas e barradas pelo rate limit. Os argumentos são gravados com segredos mascarados.
- **Métricas Prometheus** em `/metrics` e em JSON na API admin.
- **API administrativa** e **painel web** para gerenciar servidores, chaves, usuários, perfis, auditoria e aprovações.
- **Aprovação humana** (fase 6): chamadas que casam com uma regra ficam pausadas até alguém aprovar ou recusar no painel.
- **Mascaramento de segredos** (fase 7): respostas das ferramentas são varridas e valores sensíveis (API keys, tokens, CPF, cartão) são substituídos por `***` antes de chegar ao modelo e ao audit log. Os argumentos enviados pelo cliente também são mascarados antes de irem para o banco.
- **Proxy de `resources` e `prompts`**: além de ferramentas, o gateway agrega os resources (estáticos e templates) e os prompts dos upstreams, com `resources/read`, `resources/templates/list` e `prompts/get` roteados para o servidor de origem.
- **Monitor de saúde e reconexão**: ping periódico de cada servidor, com status/latência na API admin e em métricas Prometheus. Servidores que caem ou não sobem na inicialização são reconectados automaticamente.
- **Cache de ferramentas de leitura**: resultados de ferramentas com nome de leitura (`get_*`, `list_*`, `getUser`, ...) e sem nenhum verbo de escrita no nome são cacheados por TTL.
- **Persistência em PostgreSQL** via drizzle-orm; servidores cadastrados sobrevivem a reinícios, e o banco é a fonte da verdade.

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
| Build / dev | `tsup`, `tsx` |

## Requisitos

- Node.js 20.12+ (o projeto usa `process.loadEnvFile`, que não existe em versões anteriores).
- PostgreSQL e Redis (localmente via Docker ou instâncias próprias).

## Como rodar (desenvolvimento)

```bash
# 1. dependências
npm install

# 2. suba Postgres e Redis
npm run db:up
npm run redis:up

# 3. variáveis de ambiente (opcional: sem .env valem os padrões da tabela abaixo)
cp .env.example .env
#    ajuste DATABASE_URL/REDIS_URL se usar instâncias próprias

# 4. crie o schema e popule users/perfis/chaves/regras
#    (o gateway e o seed também aplicam as migrações pendentes ao iniciar)
npm run db:migrate
npm run db:seed

# 5. suba o gateway
npm run dev
```

No primeiro `db:seed` são impressas as **API keys** (admin, developer, readonly). Guarde-as: elas só aparecem uma vez, e rodar o seed de novo não gera chaves novas para quem já tem uma. O gateway fica em `http://localhost:3000`.

## Como rodar (Docker)

O `docker-compose.yml` sobe Postgres, Redis, um container de migração e o gateway. O container `migrate` aplica as migrações e roda o seed **antes** do gateway (ele precisa terminar com sucesso).

```bash
npm run docker:up          # docker compose up -d --build
npm run docker:logs        # acompanha os logs do gateway
npm run docker:down
```

As API keys do seed aparecem nos logs do container de migração, não nos do gateway:

```bash
docker compose logs migrate
```

Dentro da imagem, o compose usa `gateway.config.container.json` (que roda o servidor `echo` já compilado). O `gateway.config.json` padrão depende do `tsx` e da pasta `tests/`, que não existem na imagem de produção.

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

O arquivo só é lido **na primeira inicialização**, para popular a tabela `servers` (se ela estiver vazia). O gateway registra em `gateway_settings` que esse bootstrap já aconteceu. Depois disso, o banco é a única fonte da verdade: você adiciona e remove servidores pelo painel ou pela API admin, sem reiniciar, e remover todos não faz os servidores do arquivo voltarem no próximo restart.

### Registrar um servidor (painel e API)

O gateway suporta dois tipos de servidor, e cada tipo usa campos diferentes:

**`stdio`** — o gateway **inicia um processo** e conversa com ele por stdin/stdout.

| Campo | O que é | Exemplo |
| --- | --- | --- |
| `name` | Nome do servidor. Vira prefixo das ferramentas (`filesystem__read_file`). | `filesystem` |
| `command` | Programa que será executado. | `npx`, `node`, `python` |
| `args` | Argumentos do programa (lista JSON na API). No painel, separe por espaço e use aspas para valores com espaço. | `["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]` |
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
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
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
| POST | `/mcp` | API key | Endpoint MCP (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`) |
| GET | `/health` | — | Healthcheck |
| GET | `/docs` | — | Swagger UI |
| GET | `/openapi.json` | — | Especificação OpenAPI |
| GET | `/panel` | — | Painel web (a chave admin é digitada na tela) |
| GET | `/metrics` | admin | Métricas no formato Prometheus |

### API administrativa (`/admin`, exige API key de perfil admin)

- `GET /admin/servers`, `POST /admin/servers`, `DELETE /admin/servers/:name`
- `POST /admin/servers/:name/refresh` (recarrega a lista de ferramentas; se o servidor estiver cadastrado mas desconectado, tenta reconectar e retorna `reconnected: true`), `POST /admin/servers/:name/ping` (testa a conexão, retorna `{ ok, latencyMs }`)
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

Clientes enviam a API key no header `x-api-key` (ou `Authorization: Bearer <key>`). A chave é comparada pelo hash e resolve um usuário + perfil; o perfil define quais ferramentas aparecem em `tools/list` e podem ser chamadas. Chaves ausentes, revogadas ou expiradas retornam HTTP `401`.

Erros de aplicação voltam como erros JSON-RPC com HTTP 200, para que o cliente MCP consiga tratá-los:

| Código | Quando |
| --- | --- |
| `-32003` | Ferramenta fora do perfil do usuário (a resposta é a mesma exista a ferramenta ou não) |
| `-32004` | Chamada recusada pelo aprovador ou não aprovada a tempo |
| `-32602` | Parâmetros inválidos, ou ferramenta/resource/prompt desconhecido |
| `-32601` | Método desconhecido |
| `-32603` | Falha no servidor upstream |

O RBAC por perfil cobre apenas ferramentas. `resources/*` e `prompts/*` ficam disponíveis para qualquer chave válida.

## Rate limit

Cada usuário tem **um único orçamento** de `RATE_LIMIT_POINTS` requisições a cada `RATE_LIMIT_DURATION` segundos, somando todos os métodos, todas as ferramentas e todas as chaves dele. Trocar o nome do método ou da ferramenta não abre um orçamento novo.

- Acima do limite, o gateway responde HTTP `429` com o header `Retry-After`.
- O contador fica no Redis, então é compartilhado entre instâncias. Se o Redis cair, cada instância passa a limitar em memória com os mesmos valores, em vez de liberar tudo. Se nem isso responder, a requisição é negada com HTTP `503`.
- Chamadas barradas a `tools/call`, `resources/read` e `prompts/get` entram no audit log com status `rate_limited`.

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
4. Se aprovado, a ferramenta é executada e o resultado volta ao cliente. Se recusado ou se o tempo (`APPROVAL_TIMEOUT_SECONDS`) esgotar, o cliente recebe um erro JSON-RPC `-32004` e a chamada entra no audit log como `rejected` ou `expired`.

Detalhes:

- O aprovador vê os argumentos com segredos mascarados. A ferramenta roda com os argumentos originais, que ficam só na memória do processo.
- Depois do prazo, o pedido não pode mais ser aprovado: `POST /admin/approvals/:id/approve` retorna `404`. Isso evita que o banco diga "aprovado" enquanto o cliente já recebeu `-32004`.
- Se a gravação da expiração no banco falhar, o cliente recebe `-32004` mesmo assim, em vez de ficar esperando.

**Demo rápida** (use a chave **admin**: os perfis `developer` e `readonly` do seed não têm acesso a `echo__*` e recebem `-32003` antes da etapa de aprovação): adicione a regra `echo__echo` na aba *Approvals*, chame a ferramenta `echo__echo` (a chamada trava), clique em **Approve** e veja o resultado chegar.

## Mascaramento de segredos (fase 7)

Antes de uma resposta de ferramenta chegar ao modelo (e de ser gravada no audit log), o gateway varre todos os campos de texto e substitui valores sensíveis por `***`. Isso evita que segredos vazem para o histórico do modelo, para os logs ou para o banco.

Os **argumentos** que o cliente envia também são mascarados antes de serem gravados em `audit_logs` e em `approvals`. Além dos padrões abaixo, qualquer valor guardado sob uma chave com nome de segredo (`password`, `token`, `api_key`, `apiKey`, `x-api-key`, `authorization`, `client_secret`, `private_key`, `cookie`, ...) vira `***`. O upstream continua recebendo os argumentos originais. Esse mascaramento por nome de chave vale só para o que é gravado: nas respostas ele não é aplicado, para não quebrar campos como `nextPageToken`.

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
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"echo__greet","arguments":{"name":"Aureo"}}}'
```

O servidor `echo` de exemplo registra os resources `echo://greeting`, `echo://leaky-doc` e o template `echo://files/{path}`, além do prompt `greet`.

## Monitor de saúde dos upstreams (fase 8)

Um monitor em background pinga cada servidor registrado a cada `HEALTH_CHECK_INTERVAL_SECONDS` segundos e guarda o último resultado (status, latência, horário).

- A lista `GET /admin/servers` ganha os campos `healthy`, `lastPingMs` e `lastCheckAt` (a coluna **Health** no painel).
- `GET /admin/health` retorna o último status de cada upstream.
- Métricas: `mcp_gateway_upstream_healthy{server}` (gauge 0/1), `mcp_gateway_upstream_ping_duration_seconds{server}` e `mcp_gateway_upstream_ping_failures_total{server}`.

Servidores que não estão mais registrados têm o estado de saúde removido automaticamente na próxima verificação.

**Reconexão automática**:

- Se o ping de um servidor conectado falha, o gateway fecha a sessão e abre uma nova com a mesma configuração. Se não conseguir, o servidor sai do catálogo até voltar.
- Servidores que não conectaram na inicialização (ou depois de uma queda) são tentados de novo a cada verificação.
- `GET /admin/servers` mostra `lastError` e `connectAttempts` para servidores desconectados. No painel, passe o mouse sobre o "no" da coluna **Connected** para ver o erro.
- `POST /admin/servers/:name/refresh` força uma tentativa na hora.
- Ao reconectar, o cache de leitura daquele servidor é limpo.

## Cache de ferramentas de leitura (fase 8)

Chamadas a ferramentas de leitura são cacheadas por `READ_CACHE_TTL_SECONDS` para evitar idas repetidas ao upstream. O gateway separa o nome original da ferramenta em palavras (funciona com `snake_case`, `kebab-case`, `camelCase` e pontos) e só cacheia quando:

1. a primeira palavra é um verbo de leitura: `get`, `list`, `read`, `search`, `fetch`, `find`, `describe`, `show`, `lookup`, `stat`, `info`, `status` ou `head`; e
2. nenhuma palavra do nome indica efeito colateral (`create`, `update`, `delete`, `replace`, `send`, `run`, `execute`, `notify`, `sql`, `query` e outras).

Exemplos: `get_counter`, `listFiles` e `get-user` são cacheados. `get_or_create_user`, `find_and_replace`, `read_and_delete`, `show_notification` e `query` não são. Na dúvida, a ferramenta não é cacheada.

- A chave é `servidor:ferramenta:argumentos` (argumentos serializados de forma estável, independente da ordem das chaves).
- Só respostas bem-sucedidas são cacheadas; o valor guardado já passou pelo mascaramento de segredos.
- O cache é invalidado só para o servidor afetado ao dar `refresh`, registrar, remover ou reconectar um servidor, além do TTL.
- Métrica: `mcp_gateway_tool_cache_total{server,result}` (`hit`/`miss`).
- Controle por env: `READ_CACHE_ENABLED`, `READ_CACHE_TTL_SECONDS`, `READ_CACHE_MAX_ENTRIES`.

## Audit log

Cada linha de `audit_logs` (e de `GET /admin/audit`) traz `method` (`tools/call`, `resources/read` ou `prompts/get`), usuário, servidor, alvo (`toolName`: nome da ferramenta ou do prompt, ou URI do resource), argumentos mascarados, resposta mascarada, latência e `status`:

| Status | Quando |
| --- | --- |
| `success` / `error` | A chamada chegou ao upstream (ou ao cache, com latência 0) |
| `forbidden` | Ferramenta fora do perfil |
| `unknown_tool` / `unknown_resource` / `unknown_prompt` | O alvo não existe no catálogo |
| `rejected` / `expired` | Aprovação recusada ou não decidida a tempo |
| `rate_limited` | Barrada pelo rate limit |

Uma falha ao gravar o audit é registrada no log do gateway e não muda a resposta: uma ferramenta que já executou não aparece como falha para o cliente.

## Limitações conhecidas

O projeto está na versão 0.1. Antes de usar em produção, considere:

- **Transporte do cliente**: o `POST /mcp` responde cada requisição com um único JSON. Não há streaming via SSE nem gerenciamento de sessão (`Mcp-Session-Id`) do lado do gateway. Para os upstreams HTTP, o gateway usa o cliente Streamable HTTP do SDK oficial.
- **RBAC só para ferramentas**: `resources/*` e `prompts/*` não são filtrados por perfil.
- **Uma instância só**: a espera por aprovações, o cache de leitura e o estado de reconexão ficam em memória do processo. Com várias réplicas, uma aprovação feita em uma instância não libera a chamada pausada em outra. Postgres e Redis já são compartilhados.
- **Pedidos pendentes após restart**: se o gateway reiniciar com aprovações pendentes, essas chamadas se perdem (o cliente recebe erro de conexão). Os pedidos aparecem como `expired` assim que passa o prazo.

## Testes

```bash
npm test            # jest
npm run test:watch
npm run typecheck   # tsc --noEmit
```

Os testes ficam em `tests/`, separados por área (`config`, `gateway`, `http`, `middleware`, `services`). Para rodar a suíte completa:

- **PostgreSQL** no ar (`npm run db:up`), com o seed aplicado (`npm run db:seed`), porque vários testes gravam no audit com o usuário de id 1.
- **Redis** no ar (`npm run redis:up`) para `tests/middleware/rateLimit.test.ts`.
- `node_modules` instalado: os testes de gateway sobem o servidor `echo` com `npx tsx`.

Se o seu Postgres ou Redis estiver em outra porta, passe `DATABASE_URL` e `REDIS_URL` ao rodar o `npm test`.

## Estrutura do projeto

```
src/
├── index.ts              # sobe o Express, conecta upstreams e DB
├── logger.ts             # logger pino
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
│   ├── auth.ts · adminAuth.ts · cors.ts · rateLimit.ts · errorHandler.ts
├── gateway/
│   ├── registry.ts       # sessões com os upstreams + reconexão
│   ├── router.ts         # métodos MCP, RBAC, aprovação, cache, audit
│   ├── catalog.ts · healthMonitor.ts · auditTarget.ts · constants.ts
│   └── upstream/{stdioClient.ts,httpClient.ts}
├── services/
│   ├── access.ts · credentials.ts · apiKeys.ts
│   ├── approvals.ts      # regras + fila de aprovação humana
│   ├── redaction.ts      # mascaramento de segredos nas respostas
│   ├── readCache.ts      # cache de ferramentas de leitura
│   ├── health.ts         # último status de saúde dos upstreams
│   ├── serverBootstrap.ts # seed único dos servidores a partir do config
│   ├── auditLog.ts · metrics.ts · rateLimiter.ts · serverStore.ts · settings.ts
├── db/
│   ├── schema.ts · client.ts · migrate.ts · seed.ts
└── types/
tests/                    # config, gateway, http, middleware, services
migrations/               # SQL gerado pelo drizzle-kit
```

## Scripts úteis

| Script | O que faz |
| --- | --- |
| `npm run dev` | Roda o gateway com `tsx` (sem build) |
| `npm run build` | Build de produção com `tsup` |
| `npm start` | Roda o build (`node dist/index.js`) |
| `npm run typecheck` | `tsc --noEmit` em `src/` |
| `npm run db:generate` | Gera uma migração a partir do schema |
| `npm run db:migrate` | Aplica as migrações |
| `npm run db:seed` | Popula perfis, usuários, chaves e regras padrão |
| `npm test` / `test:watch` | Testes com jest |
| `npm run db:up` / `redis:up` | Sobe só o Postgres / só o Redis |
| `npm run infra:up` / `infra:down` | `docker compose up -d` / `down` sem rebuild |
| `npm run docker:up` / `docker:down` | Sobe (com build) / derruba a stack completa |
| `npm run docker:logs` | Acompanha os logs do container do gateway |

## Licença

[MIT](LICENSE) © Aureo Bueno
