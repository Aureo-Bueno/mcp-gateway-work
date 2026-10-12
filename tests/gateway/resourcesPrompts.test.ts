import path from 'node:path'
import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { registry } from '../../src/gateway/registry'
import { handleMcpRequest } from '../../src/gateway/router'
import { parseExposedResourceUri } from '../../src/gateway/catalog'
import type { CallerContext, JsonRpcResponse } from '../../src/types/index'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')

const caller: CallerContext = {
  userId: 1,
  userName: 'admin',
  profile: 'admin',
  keyPrefix: 'test',
  allowedPatterns: ['*'],
}

const asResult = (response: JsonRpcResponse): unknown =>
  'result' in response ? response.result : undefined

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  await registry.register({ name: 'echo', type: 'stdio', command: 'npx', args: ['tsx', fixture] })
}, 30000)

afterAll(async () => {
  await registry.unregister('echo')
  await closeDb()
})

describe('resources and prompts proxy (end to end through the router)', () => {
  it('initializes with resources and prompts capabilities', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      caller
    )
    const result = asResult(response) as { capabilities: { resources: unknown; prompts: unknown } }
    expect(result.capabilities.resources).toBeDefined()
    expect(result.capabilities.prompts).toBeDefined()
  })

  it('lists resources under the mcp-gateway:// namespace', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, caller)
    const { resources } = asResult(response) as { resources: Array<{ uri: string }> }
    expect(resources.some((resource) => resource.uri === 'mcp-gateway://echo/echo://greeting')).toBe(
      true
    )
    expect(resources.some((resource) => resource.uri === 'mcp-gateway://echo/echo://leaky-doc')).toBe(
      true
    )
  })

  it('lists resource templates', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'resources/templates/list' },
      caller
    )
    const { resourceTemplates } = asResult(response) as {
      resourceTemplates: Array<{ uriTemplate: string }>
    }
    expect(
      resourceTemplates.some(
        (template) => template.uriTemplate === 'mcp-gateway://echo/echo://files/{path}'
      )
    ).toBe(true)
  })

  it('reads a static resource through the gateway', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'mcp-gateway://echo/echo://greeting' },
      },
      caller
    )
    expect(JSON.stringify(response)).toContain('Hello from echo-server!')
  })

  it('reads a resource produced by a template', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'mcp-gateway://echo/echo://files/report.txt' },
      },
      caller
    )
    expect(JSON.stringify(response)).toContain('echo report.txt')
  })

  it('redacts sensitive data inside resource contents', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'resources/read',
        params: { uri: 'mcp-gateway://echo/echo://leaky-doc' },
      },
      caller
    )
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('sk-live0123456789abcdefGHIJ')
    expect(serialized).toContain('***')
  })

  it('returns -32603 when the upstream cannot resolve a resource', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'resources/read',
        params: { uri: 'mcp-gateway://echo/echo://nope' },
      },
      caller
    )
    expect('error' in response && response.error.code).toBe(-32603)
  })

  it('returns -32602 for a resource outside the gateway namespace', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'resources/read',
        params: { uri: 'file:///tmp/whatever' },
      },
      caller
    )
    expect('error' in response && response.error.code).toBe(-32602)
  })

  it('lists prompts with the server prefix', async () => {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: 9, method: 'prompts/list' }, caller)
    const { prompts } = asResult(response) as { prompts: Array<{ name: string }> }
    expect(prompts.some((prompt) => prompt.name === 'echo__greet')).toBe(true)
  })

  it('gets a prompt and renders its messages', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'prompts/get',
        params: { name: 'echo__greet', arguments: { name: 'Rafael' } },
      },
      caller
    )
    expect(JSON.stringify(response)).toContain('Olá, Rafael!')
  })

  it('rejects get of an unknown prompt', async () => {
    const response = await handleMcpRequest(
      { jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'echo__nope' } },
      caller
    )
    expect('error' in response && response.error.code).toBe(-32602)
  })
})

describe('exposed resource uri helpers', () => {
  it('parses the server and original uri back out', () => {
    expect(parseExposedResourceUri('mcp-gateway://echo/echo://files/a%20b.txt')).toEqual({
      server: 'echo',
      uri: 'echo://files/a%20b.txt',
    })
  })

  it('returns undefined for foreign uris', () => {
    expect(parseExposedResourceUri('file:///tmp/x')).toBeUndefined()
    expect(parseExposedResourceUri('mcp-gateway://')).toBeUndefined()
  })
})