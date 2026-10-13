import { NO_HTTP_FORBIDDEN_PATHS, openApiDocument } from '../../src/http/openapi'

interface Operation {
  security?: unknown
  responses?: Record<string, unknown>
}

const paths = openApiDocument['paths'] as Record<string, Record<string, Operation>>

describe('openApiDocument', () => {
  it('serves from a relative URL so docs call the same origin', () => {
    const servers = openApiDocument['servers'] as Array<{ url: string }>
    expect(servers[0]?.url).toBe('/')
  })

  it('documents 401 and 403 for every secured operation (except /mcp)', () => {
    const missing: string[] = []
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (operation.security === undefined) {
          continue
        }
        if (operation.responses?.['401'] === undefined) {
          missing.push(`${method.toUpperCase()} ${path} -> missing 401`)
        }
        if (!NO_HTTP_FORBIDDEN_PATHS.has(path) && operation.responses?.['403'] === undefined) {
          missing.push(`${method.toUpperCase()} ${path} -> missing 403`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('does not document HTTP 403 for /mcp, where authorization errors are JSON-RPC', () => {
    expect(paths['/mcp']?.['post']?.responses?.['403']).toBeUndefined()
  })

  it('declares the API key security scheme for the Authorize button', () => {
    const components = openApiDocument['components'] as Record<string, unknown>
    const schemes = components['securitySchemes'] as Record<string, unknown>
    expect(schemes['ApiKeyAuth']).toBeDefined()
  })
})
