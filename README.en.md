# MCP Gateway

[Português](README.md) · **English**

A TypeScript gateway that sits in front of multiple [MCP](https://modelcontextprotocol.io) servers and presents them to the client as **a single MCP server**. It adds authentication, per-profile authorization, rate limiting, auditing, metrics and **human approval** for dangerous tools.

```
MCP client (Claude, agent, IDE)
        │  HTTP + JSON-RPC  (POST /mcp)
        ▼
┌────────────────────────────────────────────┐
│  MCP GATEWAY (Express + TypeScript)        │
│  auth → rate limit → RBAC → approval →     │
│  router → registry · redaction · audit ·   │
│  metrics                                   │
└───────┬───────────────────────┬────────────┘
        │ stdio                 │ HTTP
        ▼                       ▼
  MCP Server A            MCP Server B
```

To the client, the gateway looks like one server. To each real server, it acts as an MCP client: it keeps a session open, merges every tool into a single catalog and prefixes names (`github__create_issue`) to avoid collisions.

## Features

- **Aggregation** of `stdio` and `HTTP` MCP servers behind one endpoint, with names prefixed by server.
- **API keys** stored only as a SHA-256 hash, with a visible prefix and revocation.
- **Profiles and RBAC**: each profile has allowed tool patterns (e.g. `github__list_*`). Enforcement applies to `tools/list` and `tools/call`; a forbidden tool returns JSON-RPC error `-32003`.
- **Rate limiting** per user, backed by Redis, with an in-memory fallback if Redis goes down.
- **Audit log** of tool calls, `resources/read` and `prompts/get`, including forbidden, unknown, rejected, expired and rate-limited ones. Arguments are stored with secrets masked.
- **Prometheus metrics** at `/metrics` and as JSON in the admin API.
- **Admin API** and **web panel** to manage servers, keys, users, profiles, audit and approvals.
- **Human approval** (phase 6): calls matching a rule are paused until someone approves or rejects them in the panel.
- **Secret redaction** (phase 7): tool responses are scanned and sensitive values (API keys, tokens, CPF, credit cards) are replaced with `***` before they reach the model and the audit log. Arguments sent by the client are masked too before they are written to the database.
- **`resources` and `prompts` proxy**: besides tools, the gateway aggregates upstream resources (static and templates) and prompts, routing `resources/read`, `resources/templates/list` and `prompts/get` to the originating server.
- **Health monitor and reconnection**: periodic ping of each server, with status/latency in the admin API and in Prometheus metrics. Servers that drop or fail to start are reconnected automatically.
- **Read-only tool cache**: results from tools with a read name (`get_*`, `list_*`, `getUser`, ...) and no write verb anywhere in the name are cached with a TTL.
- **PostgreSQL persistence** via drizzle-orm; registered servers survive restarts, and the database is the source of truth.

## Stack

| Layer | Choice |
| --- | --- |
| MCP protocol | `@modelcontextprotocol/sdk` |
| HTTP | `express` |
| Validation | `zod` |
| Database | PostgreSQL with `drizzle-orm` and `pg` |
| Cache / rate limit | Redis with `rate-limiter-flexible` |
| Logs | `pino` |
| Metrics | `prom-client` |
| Docs | `swagger-ui-express` |
| Tests | `jest` + `@swc/jest` + `supertest` |
| Build / dev | `tsup`, `tsx` |

## Requirements

- Node.js 20.12+ (the project uses `process.loadEnvFile`, which doesn't exist in earlier versions).
- PostgreSQL and Redis (locally via Docker or your own instances).

## Running (development)

```bash
# 1. dependencies
npm install

# 2. start Postgres and Redis
npm run db:up
npm run redis:up

# 3. environment variables (optional: without a .env the defaults below apply)
cp .env.example .env
#    adjust DATABASE_URL/REDIS_URL if you use your own instances

# 4. create the schema and seed users/profiles/keys/rules
#    (the gateway and the seed also apply pending migrations on start)
npm run db:migrate
npm run db:seed

# 5. start the gateway
npm run dev
```

The first `db:seed` prints the **API keys** (admin, developer, readonly). Save them: they are shown only once, and running the seed again doesn't create new keys for users who already have one. The gateway runs at `http://localhost:3000`.

## Running (Docker)

`docker-compose.yml` starts Postgres, Redis, a migration container and the gateway. The `migrate` container applies migrations and runs the seed **before** the gateway (it must exit successfully).

```bash
npm run docker:up          # docker compose up -d --build
npm run docker:logs        # follow gateway logs
npm run docker:down
```

The seed API keys show up in the migration container logs, not in the gateway's:

```bash
docker compose logs migrate
```

Inside the image, compose uses `gateway.config.container.json` (which runs the prebuilt `echo` server). The default `gateway.config.json` depends on `tsx` and the `tests/` folder, which aren't in the production image.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Gateway HTTP port |
| `DATABASE_URL` | `postgres://mcp:mcp@localhost:5432/mcp_gateway` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection (rate limit) |
| `GATEWAY_CONFIG` | `gateway.config.json` | File with the initial servers |
| `LOG_LEVEL` | `info` | pino log level (`debug`/`info`/`warn`/`error`) |
| `RATE_LIMIT_POINTS` | `100` | Requests allowed per window |
| `RATE_LIMIT_DURATION` | `60` | Window size, in seconds |
| `APPROVAL_TIMEOUT_SECONDS` | `120` | How long a call waits for approval before expiring |
| `CORS_ORIGIN` | `*` | Allowed CORS origin (e.g. `http://localhost:5173`) |
| `REDACTION_ENABLED` | `true` | Toggles secret redaction in responses |
| `REDACTION_REPLACEMENT` | `***` | Text that replaces each sensitive value |
| `HEALTH_CHECK_INTERVAL_SECONDS` | `30` | Interval between upstream health pings |
| `READ_CACHE_ENABLED` | `true` | Toggles the read-only tool cache |
| `READ_CACHE_TTL_SECONDS` | `30` | Time to live of each read cache entry |
| `READ_CACHE_MAX_ENTRIES` | `500` | Maximum number of cache entries (FIFO eviction) |

### `gateway.config.json` format

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

The file is only read **on the very first start**, to seed the `servers` table (if it is empty). The gateway records in `gateway_settings` that this bootstrap happened. After that, the database is the only source of truth: you add and remove servers from the panel or the admin API without restarting, and removing all of them does not bring the file's servers back on the next restart.

### Registering a server (panel and API)

The gateway supports two server types, each with its own fields:

**`stdio`**: the gateway **spawns a process** and talks to it over stdin/stdout.

| Field | Meaning | Example |
| --- | --- | --- |
| `name` | Server name. Becomes the tool prefix (`filesystem__read_file`). | `filesystem` |
| `command` | Program to run. | `npx`, `node`, `python` |
| `args` | Program arguments (JSON list in the API). In the panel, separate them with spaces and quote values that contain spaces. | `["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]` |
| `env` | Process environment variables (optional), `KEY=VALUE`. Tokens/secrets the server needs go here. | `GITHUB_TOKEN=ghp_xxx` |

**`http`**: the gateway **connects to a remote MCP server** (Streamable HTTP). It doesn't spawn a process, so there is no `command`/`args`/`env`.

| Field | Meaning | Example |
| --- | --- | --- |
| `name` | Same as above. | `github` |
| `url` | MCP endpoint URL. | `http://host:8080/mcp` |
| `headers` | Headers sent with every request (optional), `KEY=VALUE`. The equivalent of `env` for stdio: authentication goes here. | `Authorization=Bearer ghp_xxx` |

Example bodies for `POST /admin/servers`:

```json
{ "name": "filesystem", "type": "stdio", "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
  "env": { "GITHUB_TOKEN": "ghp_xxx" } }
```

```json
{ "name": "github", "type": "http", "url": "http://host:8080/mcp",
  "headers": { "Authorization": "Bearer ghp_xxx" } }
```

In the panel, pick the **Type** and the form shows only the fields for that type.

## Endpoints

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| POST | `/mcp` | API key | MCP endpoint (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`) |
| GET | `/health` | none | Healthcheck |
| GET | `/docs` | none | Swagger UI |
| GET | `/openapi.json` | none | OpenAPI specification |
| GET | `/panel` | none | Web panel (the admin key is entered on screen) |
| GET | `/metrics` | admin | Prometheus metrics |

### Admin API (`/admin`, requires an admin-profile API key)

- `GET /admin/servers`, `POST /admin/servers`, `DELETE /admin/servers/:name`
- `POST /admin/servers/:name/refresh` (reloads the tool list; if the server is persisted but disconnected, it tries to reconnect and returns `reconnected: true`), `POST /admin/servers/:name/ping` (tests the connection, returns `{ ok, latencyMs }`)
- `GET /admin/catalog`
- `GET /admin/health` (latest health status of each upstream), `POST /admin/health/check` (runs a check now and returns the summary)
- `GET /admin/audit`
- `GET /admin/metrics` (JSON)
- `GET /admin/api-keys`, `POST /admin/api-keys`, `DELETE /admin/api-keys/:id`
- `GET /admin/users`, `POST /admin/users`
- `GET /admin/profiles`, `POST /admin/profiles`, `PUT /admin/profiles/:name/tools`
- `GET /admin/approvals`, `POST /admin/approvals/:id/approve`, `POST /admin/approvals/:id/reject`
- `GET /admin/approval-rules`, `POST /admin/approval-rules`, `DELETE /admin/approval-rules/:id`

## Authentication

Clients send the API key in the `x-api-key` header (or `Authorization: Bearer <key>`). The gateway compares the key by hash and resolves a user + profile; the profile defines which tools appear in `tools/list` and can be called. Missing, revoked or expired keys return HTTP `401`.

Application errors come back as JSON-RPC errors with HTTP 200, so MCP clients can handle them:

| Code | When |
| --- | --- |
| `-32003` | Tool outside the user's profile (same answer whether or not the tool exists) |
| `-32004` | Call rejected by the approver or not approved in time |
| `-32602` | Invalid params, or unknown tool/resource/prompt |
| `-32601` | Unknown method |
| `-32603` | Upstream server failure |

Profile-based RBAC covers tools only. `resources/*` and `prompts/*` are available to any valid key.

## Rate limiting

Each user has **a single budget** of `RATE_LIMIT_POINTS` requests every `RATE_LIMIT_DURATION` seconds, shared by all their methods, tools and keys. Changing the method or tool name does not open a new budget.

- Over the limit, the gateway answers HTTP `429` with a `Retry-After` header.
- The counter lives in Redis, so it is shared across instances. If Redis goes down, each instance keeps limiting in memory with the same values instead of letting everything through. If even that fails, the request is denied with HTTP `503`.
- Rejected `tools/call`, `resources/read` and `prompts/get` requests are written to the audit log with status `rate_limited`.

## Human approval for dangerous tools (phase 6)

Approval rules are tool name patterns (same syntax as RBAC, with `*`). The seed creates default rules for destructive operations, for example:

```
*__delete_*   *__delete   *__remove_*   *__drop_*
*__create_*   *__update_*  *__write_*    *__execute_*   *__send_*
```

Call flow:

1. The client calls `tools/call` on a tool that matches an active rule.
2. Instead of executing, the gateway creates a pending **approval request** and the request is **paused**.
3. Someone approves or rejects it in the panel (`/panel`, **Approvals** tab) or via `POST /admin/approvals/:id/approve|reject`.
4. If approved, the tool runs and the result goes back to the client. If rejected, or if the timeout (`APPROVAL_TIMEOUT_SECONDS`) expires, the client receives JSON-RPC error `-32004` and the call is audited as `rejected` or `expired`.

Details:

- Approvers see the arguments with secrets masked. The tool runs with the original arguments, which are kept only in process memory.
- After the deadline, the request can no longer be approved: `POST /admin/approvals/:id/approve` returns `404`. This keeps the database from saying "approved" after the client already got `-32004`.
- If writing the expiry to the database fails, the client still gets `-32004` instead of waiting forever.

**Quick demo** (use the **admin** key: the seeded `developer` and `readonly` profiles can't access `echo__*` and get `-32003` before the approval step): add the rule `echo__echo` in the *Approvals* tab, call the `echo__echo` tool (the call hangs), click **Approve** and watch the result arrive.

## Secret redaction (phase 7)

Before a tool response reaches the model (and before it is written to the audit log), the gateway scans every text field and replaces sensitive values with `***`. This keeps secrets out of the model history, the logs and the database.

The **arguments** sent by the client are masked too before they are written to `audit_logs` and `approvals`. On top of the patterns below, any value stored under a secret-looking key (`password`, `token`, `api_key`, `apiKey`, `x-api-key`, `authorization`, `client_secret`, `private_key`, `cookie`, ...) becomes `***`. The upstream still receives the original arguments. Key-name masking applies only to what is stored: responses don't get it, so fields like `nextPageToken` keep working.

Patterns detected by default:

```
sk-...            OpenAI/Anthropic keys     gh[pousr]_...   GitHub tokens
xox[baprs]-...    Slack tokens              AKIA...         AWS access keys
AIza...           Google API keys           eyJ....         JWTs
Bearer <token>    keeps the scheme          api_key=...     value after the key
123.456.789-00    CPF (Brazilian tax ID)    4111 1111 ...   credit card
```

It covers the whole response (including `structuredContent` and arrays), is configurable via env (`REDACTION_ENABLED`, `REDACTION_REPLACEMENT`) and emits the metric `mcp_gateway_tool_redactions_total{rule}`.

**Demo**: the sample `echo` server has an `echo__leak` tool that returns text with fake secrets. Call `echo__leak` and see the masked response:

```bash
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo__leak","arguments":{}}}'
# → the text comes back with "***" in place of the key, the CPF and the card
```

## `resources` and `prompts` proxy (phase 8)

Besides tools, the gateway aggregates upstream **resources** and **prompts**. On `initialize` it advertises `tools`, `resources` and `prompts`; methods are routed to the originating server.

| MCP method | What it does |
| --- | --- |
| `resources/list` | Lists static resources from all upstreams |
| `resources/templates/list` | Lists URI templates (dynamic resources) |
| `resources/read` | Reads a resource by its exposed URI |
| `prompts/list` | Lists prompts, prefixed by server (`echo__greet`) |
| `prompts/get` | Resolves a prompt with arguments |

**URI namespacing**: since two servers can expose the same URI, every resource is exposed under the `mcp-gateway://<server>/<original-uri>` scheme. E.g. the `echo://greeting` resource from the `echo` server appears as `mcp-gateway://echo/echo://greeting`. The gateway strips the prefix and forwards the original URI to the upstream. This works for static resources and for URIs built from a template (`mcp-gateway://echo/echo://files/{path}`).

Content read this way also goes through **secret redaction**. Prompts follow the same prefix convention as tools (`server__name`).

```bash
# resources
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}'
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"mcp-gateway://echo/echo://greeting"}}'

# prompts
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list"}'
curl -s -X POST http://localhost:3000/mcp -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"echo__greet","arguments":{"name":"Aureo"}}}'
```

The sample `echo` server registers the resources `echo://greeting`, `echo://leaky-doc` and the template `echo://files/{path}`, plus the `greet` prompt.

## Upstream health monitor (phase 8)

A background monitor pings each registered server every `HEALTH_CHECK_INTERVAL_SECONDS` seconds and stores the latest result (status, latency, timestamp).

- `GET /admin/servers` gains the fields `healthy`, `lastPingMs` and `lastCheckAt` (the **Health** column in the panel).
- `GET /admin/health` returns the latest status of each upstream.
- Metrics: `mcp_gateway_upstream_healthy{server}` (0/1 gauge), `mcp_gateway_upstream_ping_duration_seconds{server}` and `mcp_gateway_upstream_ping_failures_total{server}`.

Servers that are no longer registered have their health state removed on the next check.

**Automatic reconnection**:

- If a connected server's ping fails, the gateway closes the session and opens a new one with the same config. If that fails, the server leaves the catalog until it comes back.
- Servers that didn't connect at startup (or after a drop) are retried on every check.
- `GET /admin/servers` shows `lastError` and `connectAttempts` for disconnected servers. In the panel, hover the "no" in the **Connected** column to see the error.
- `POST /admin/servers/:name/refresh` forces an attempt right away.
- On reconnect, that server's read cache is cleared.

## Read-only tool cache (phase 8)

Calls to read tools are cached for `READ_CACHE_TTL_SECONDS` to avoid repeated upstream calls. The gateway splits the original tool name into words (it handles `snake_case`, `kebab-case`, `camelCase` and dots) and caches only when:

1. the first word is a read verb: `get`, `list`, `read`, `search`, `fetch`, `find`, `describe`, `show`, `lookup`, `stat`, `info`, `status` or `head`; and
2. no word in the name signals a side effect (`create`, `update`, `delete`, `replace`, `send`, `run`, `execute`, `notify`, `sql`, `query` and others).

Examples: `get_counter`, `listFiles` and `get-user` are cached. `get_or_create_user`, `find_and_replace`, `read_and_delete`, `show_notification` and `query` are not. When in doubt, the tool is not cached.

- The key is `server:tool:arguments` (arguments serialized in a stable way, independent of key order).
- Only successful responses are cached; the stored value has already gone through secret redaction.
- The cache is invalidated only for the affected server on `refresh`, register, removal or reconnect, in addition to the TTL.
- Metric: `mcp_gateway_tool_cache_total{server,result}` (`hit`/`miss`).
- Env controls: `READ_CACHE_ENABLED`, `READ_CACHE_TTL_SECONDS`, `READ_CACHE_MAX_ENTRIES`.

## Audit log

Each `audit_logs` row (and each `GET /admin/audit` entry) has `method` (`tools/call`, `resources/read` or `prompts/get`), user, server, target (`toolName`: tool or prompt name, or resource URI), masked arguments, masked response, latency and `status`:

| Status | When |
| --- | --- |
| `success` / `error` | The call reached the upstream (or the cache, with latency 0) |
| `forbidden` | Tool outside the profile |
| `unknown_tool` / `unknown_resource` / `unknown_prompt` | The target isn't in the catalog |
| `rejected` / `expired` | Approval rejected or not decided in time |
| `rate_limited` | Stopped by the rate limiter |

A failed audit write is logged by the gateway and doesn't change the response: a tool that already ran isn't reported to the client as failed.

## Known limitations

The project is at version 0.1. Before using it in production, keep in mind:

- **Client transport**: `POST /mcp` answers each request with a single JSON response. There is no SSE streaming and no gateway-side session management (`Mcp-Session-Id`). For HTTP upstreams, the gateway uses the official SDK's Streamable HTTP client.
- **RBAC for tools only**: `resources/*` and `prompts/*` are not filtered by profile.
- **Single instance**: pending approval waits, the read cache and the reconnection state live in process memory. With multiple replicas, an approval made on one instance won't release a call paused on another. Postgres and Redis are already shared.
- **Pending requests after a restart**: if the gateway restarts with pending approvals, those calls are lost (the client gets a connection error). The requests show as `expired` once their deadline passes.

## Tests

```bash
npm test            # jest
npm run test:watch
npm run typecheck   # tsc --noEmit
```

Tests live in `tests/`, grouped by area (`config`, `gateway`, `http`, `middleware`, `services`). To run the full suite you need:

- **PostgreSQL** running (`npm run db:up`) with the seed applied (`npm run db:seed`), because several tests write audit rows for user id 1.
- **Redis** running (`npm run redis:up`) for `tests/middleware/rateLimit.test.ts`.
- `node_modules` installed: the gateway tests start the `echo` server with `npx tsx`.

If your Postgres or Redis runs on another port, pass `DATABASE_URL` and `REDIS_URL` when running `npm test`.

## Project structure

```
src/
├── index.ts              # starts Express, connects upstreams and DB
├── logger.ts             # pino logger
├── config/
│   ├── env.ts            # env validated with zod
│   └── servers.ts        # server types/validation
├── http/
│   ├── app.ts            # wires middlewares and routes
│   ├── mcpRoute.ts       # POST /mcp (client entry point)
│   ├── adminRoutes.ts    # admin API
│   ├── jsonrpc.ts        # JSON-RPC schemas and helpers
│   ├── openapi.ts        # OpenAPI specification
│   └── panel.ts          # web panel (HTML)
├── middleware/
│   ├── auth.ts · adminAuth.ts · cors.ts · rateLimit.ts · errorHandler.ts
├── gateway/
│   ├── registry.ts       # upstream sessions + reconnection
│   ├── router.ts         # MCP methods, RBAC, approval, cache, audit
│   ├── catalog.ts · healthMonitor.ts · auditTarget.ts · constants.ts
│   └── upstream/{stdioClient.ts,httpClient.ts}
├── services/
│   ├── access.ts · credentials.ts · apiKeys.ts
│   ├── approvals.ts      # rules + human approval queue
│   ├── redaction.ts      # secret redaction in responses
│   ├── readCache.ts      # read-only tool cache
│   ├── health.ts         # latest upstream health status
│   ├── serverBootstrap.ts # one-time server seed from the config file
│   ├── auditLog.ts · metrics.ts · rateLimiter.ts · serverStore.ts · settings.ts
├── db/
│   ├── schema.ts · client.ts · migrate.ts · seed.ts
└── types/
tests/                    # config, gateway, http, middleware, services
migrations/               # SQL generated by drizzle-kit
```

## Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Runs the gateway with `tsx` (no build) |
| `npm run build` | Production build with `tsup` |
| `npm start` | Runs the build (`node dist/index.js`) |
| `npm run typecheck` | `tsc --noEmit` on `src/` |
| `npm run db:generate` | Generates a migration from the schema |
| `npm run db:migrate` | Applies migrations |
| `npm run db:seed` | Seeds default profiles, users, keys and rules |
| `npm test` / `test:watch` | Runs jest tests |
| `npm run db:up` / `redis:up` | Starts only Postgres / only Redis |
| `npm run infra:up` / `infra:down` | `docker compose up -d` / `down` without rebuilding |
| `npm run docker:up` / `docker:down` | Starts (with build) / stops the full stack |
| `npm run docker:logs` | Follows the gateway container logs |

## License

[MIT](LICENSE) © Aureo Bueno
