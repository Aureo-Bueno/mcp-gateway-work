import type { JsonObject } from 'swagger-ui-express'

const errorSchema: JsonObject = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
}

const apiKeySecurity: JsonObject[] = [{ ApiKeyAuth: [] }]

const standardErrorResponses = (): JsonObject => ({
  '401': {
    description: 'Missing or invalid API key',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '403': {
    description: 'Admin privileges required',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
})

const withStandardErrors = (document: JsonObject): JsonObject => {
  const paths = document['paths'] as Record<string, Record<string, JsonObject>> | undefined
  if (paths === undefined) {
    return document
  }

  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation['security'] === undefined) {
        continue
      }
      const responses = operation['responses']
      if (typeof responses !== 'object' || responses === null) {
        continue
      }
      const target = responses as Record<string, JsonObject>
      for (const [code, response] of Object.entries(standardErrorResponses())) {
        if (target[code] === undefined) {
          target[code] = response
        }
      }
    }
  }

  return document
}

const document: JsonObject = {
  openapi: '3.0.3',
  info: {
    title: 'MCP Gateway',
    version: '0.1.0',
    description:
      'Gateway that aggregates multiple upstream MCP servers behind a single `/mcp` endpoint, ' +
      'with API key authentication, per-profile RBAC, Redis rate limiting and audit logging.',
  },
  servers: [{ url: '/', description: 'Same origin as this docs page' }],
  tags: [
    { name: 'Health' },
    { name: 'MCP', description: 'JSON-RPC 2.0 endpoint proxy' },
    { name: 'Admin', description: 'Administrative API (requires an admin API key)' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key. Alternatively sent as `Authorization: Bearer <key>`.',
      },
    },
    schemas: {
      Error: errorSchema,
      JsonRpcRequest: {
        type: 'object',
        required: ['jsonrpc', 'method'],
        properties: {
          jsonrpc: { type: 'string', enum: ['2.0'] },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          method: { type: 'string', example: 'tools/list' },
          params: { type: 'object', additionalProperties: true },
        },
      },
      JsonRpcResponse: {
        type: 'object',
        properties: {
          jsonrpc: { type: 'string', enum: ['2.0'] },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          result: { type: 'object', additionalProperties: true },
          error: {
            type: 'object',
            properties: {
              code: { type: 'integer' },
              message: { type: 'string' },
              data: {},
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          profile: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Profile: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          patterns: { type: 'array', items: { type: 'string' }, example: ['github__*'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          userId: { type: 'integer' },
          userName: { type: 'string' },
          prefix: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreatedApiKey: {
        allOf: [
          { $ref: '#/components/schemas/ApiKey' },
          {
            type: 'object',
            properties: {
              apiKey: { type: 'string', description: 'Plaintext key. Returned only once.' },
              warning: { type: 'string' },
            },
          },
        ],
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          userId: { type: 'integer', nullable: true },
          serverName: { type: 'string' },
          toolName: { type: 'string' },
          requestJson: {},
          responseJson: {},
          latencyMs: { type: 'integer' },
          status: { type: 'string', example: 'success' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Approval: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          userId: { type: 'integer', nullable: true },
          userName: { type: 'string' },
          serverName: { type: 'string' },
          toolName: { type: 'string' },
          arguments: { type: 'object', additionalProperties: true },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'expired'] },
          decidedBy: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          decidedAt: { type: 'string', format: 'date-time', nullable: true },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      ApprovalRule: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          toolPattern: { type: 'string', example: '*__delete_*' },
          enabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        responses: { '200': { description: 'Service is up', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } } } },
      },
    },
    '/metrics': {
      get: {
        tags: ['Health'],
        summary: 'Prometheus metrics (admin only)',
        description: 'Prometheus exposition format with request, auth, rate limit, tool call, redaction, upstream health and read-cache metrics.',
        security: apiKeySecurity,
        responses: {
          '200': {
            description: 'Metrics',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          '401': { description: 'Missing API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Admin privileges required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/panel': {
      get: {
        tags: ['Admin'],
        summary: 'Web panel (HTML)',
        description: 'Self-contained admin panel UI. Enter an admin API key in the page to load data.',
        responses: { '200': { description: 'HTML page', content: { 'text/html': { schema: { type: 'string' } } } } },
      },
    },
    '/mcp': {
      post: {
        tags: ['MCP'],
        summary: 'MCP JSON-RPC endpoint',
        description:
          'Single endpoint proxying to all upstream MCP servers. Methods: `initialize`, ' +
          '`tools/list` (filtered by the caller profile), `tools/call`, `resources/list`, ' +
          '`resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`, `ping`, ' +
          'notifications. Resources are exposed under `mcp-gateway://<server>/<uri>`; prompts are ' +
          'prefixed with `<server>__`. Tool and resource responses are scanned and sensitive ' +
          'values (API keys, tokens, CPF, card numbers) are redacted before being returned.',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcRequest' } } },
        },
        responses: {
          '200': {
            description: 'JSON-RPC response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcResponse' } } },
          },
          '401': { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Tool forbidden by profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '429': { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/servers': {
      get: {
        tags: ['Admin'],
        summary: 'List registered upstream servers',
        description:
          'Each entry includes `connected`, `toolCount` and the latest health fields (`healthy`, `lastPingMs`, `lastCheckAt`).',
        security: apiKeySecurity,
        responses: { '200': { description: 'Servers', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Register a new upstream server',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'object', required: ['name', 'type', 'command'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['stdio'] }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, env: { type: 'object', additionalProperties: { type: 'string' } } } },
                  { type: 'object', required: ['name', 'type', 'url'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['http'] }, url: { type: 'string', format: 'uri' }, headers: { type: 'object', additionalProperties: { type: 'string' }, example: { Authorization: 'Bearer ghp_xxx' } } } },
                ],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Registered' },
          '400': { description: 'Invalid config', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/servers/{name}/refresh': {
      post: {
        tags: ['Admin'],
        summary: 'Refresh the tool list of a server',
        security: apiKeySecurity,
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Refreshed' },
          '404': { description: 'Not registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/servers/{name}/ping': {
      post: {
        tags: ['Admin'],
        summary: 'Ping a connected upstream server',
        description: 'Sends an MCP `ping` request to the upstream server and reports round-trip latency.',
        security: apiKeySecurity,
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Server is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    ok: { type: 'boolean' },
                    latencyMs: { type: 'integer' },
                  },
                },
              },
            },
          },
          '404': { description: 'Not registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '502': { description: 'Upstream did not respond to ping', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/servers/{name}': {
      delete: {
        tags: ['Admin'],
        summary: 'Disconnect and remove an upstream server',
        security: apiKeySecurity,
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Removed' },
          '404': { description: 'Not registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/catalog': {
      get: {
        tags: ['Admin'],
        summary: 'Full aggregated tool catalog',
        security: apiKeySecurity,
        responses: { '200': { description: 'Catalog', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
    },
    '/admin/health': {
      get: {
        tags: ['Admin'],
        summary: 'Last health status of each upstream server',
        description:
          'Returns the most recent periodic ping result per registered server: `healthy`, `latencyMs`, `checkedAt` and, on failure, `error`.',
        security: apiKeySecurity,
        responses: {
          '200': {
            description: 'Health entries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      healthy: { type: 'boolean' },
                      latencyMs: { type: 'integer', nullable: true },
                      checkedAt: { type: 'string', format: 'date-time' },
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/health/check': {
      post: {
        tags: ['Admin'],
        summary: 'Run upstream health checks now',
        description: 'Pings every registered upstream immediately and returns `{ checked, healthy, unhealthy }`.',
        security: apiKeySecurity,
        responses: {
          '200': {
            description: 'Health check summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    checked: { type: 'integer' },
                    healthy: { type: 'integer' },
                    unhealthy: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/admin/audit': {
      get: {
        tags: ['Admin'],
        summary: 'Recent audit log entries',
        security: apiKeySecurity,
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }],
        responses: { '200': { description: 'Entries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } } } } } },
      },
    },
    '/admin/metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Metrics as JSON',
        security: apiKeySecurity,
        responses: { '200': { description: 'Metrics objects', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
    },
    '/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List users',
        security: apiKeySecurity,
        responses: { '200': { description: 'Users', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create a user',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'profile'], properties: { name: { type: 'string' }, profile: { type: 'string' } } } } },
        },
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '400': { description: 'Invalid or unknown profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/profiles': {
      get: {
        tags: ['Admin'],
        summary: 'List profiles and their tool patterns',
        security: apiKeySecurity,
        responses: { '200': { description: 'Profiles', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Profile' } } } } } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create a profile',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, patterns: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Profile' } } } } },
      },
    },
    '/admin/profiles/{name}/tools': {
      put: {
        tags: ['Admin'],
        summary: 'Replace the tool patterns of a profile',
        security: apiKeySecurity,
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['patterns'], properties: { patterns: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: {
          '200': { description: 'Updated' },
          '404': { description: 'Unknown profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/api-keys': {
      get: {
        tags: ['Admin'],
        summary: 'List API keys (hashes are never exposed)',
        security: apiKeySecurity,
        responses: { '200': { description: 'Keys', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } } } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create an API key for a user',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['userName'], properties: { userName: { type: 'string' }, expiresInDays: { type: 'integer', default: 365 } } } } },
        },
        responses: {
          '201': { description: 'Created (plaintext key returned once)', content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatedApiKey' } } } },
          '404': { description: 'Unknown user', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/api-keys/{id}': {
      delete: {
        tags: ['Admin'],
        summary: 'Revoke an API key',
        security: apiKeySecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Revoked' },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/approvals': {
      get: {
        tags: ['Admin'],
        summary: 'List approval requests',
        security: apiKeySecurity,
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
        responses: { '200': { description: 'Approvals', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Approval' } } } } } },
      },
    },
    '/admin/approvals/{id}/approve': {
      post: {
        tags: ['Admin'],
        summary: 'Approve a pending tool call',
        security: apiKeySecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Approved', content: { 'application/json': { schema: { $ref: '#/components/schemas/Approval' } } } },
          '404': { description: 'Not pending', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/approvals/{id}/reject': {
      post: {
        tags: ['Admin'],
        summary: 'Reject a pending tool call',
        security: apiKeySecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Rejected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Approval' } } } },
          '404': { description: 'Not pending', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/admin/approval-rules': {
      get: {
        tags: ['Admin'],
        summary: 'List approval rules',
        security: apiKeySecurity,
        responses: { '200': { description: 'Rules', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApprovalRule' } } } } } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create or update an approval rule',
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' }, enabled: { type: 'boolean', default: true } } } } },
        },
        responses: { '201': { description: 'Rule saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalRule' } } } } },
      },
    },
    '/admin/approval-rules/{id}': {
      delete: {
        tags: ['Admin'],
        summary: 'Delete an approval rule',
        security: apiKeySecurity,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Deleted' },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
}

export const openApiDocument: JsonObject = withStandardErrors(document)
