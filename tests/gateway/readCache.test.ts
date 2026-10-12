import path from 'node:path'
import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { registry } from '../../src/gateway/registry'
import { handleMcpRequest } from '../../src/gateway/router'
import { clearReadCache, readCacheSize } from '../../src/services/readCache'
import type { CallerContext, JsonRpcResponse } from '../../src/types/index'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')

const caller: CallerContext = {
  userId: 1,
  userName: 'admin',
  profile: 'admin',
  keyPrefix: 'test',
  allowedPatterns: ['*'],
}

const callTool = (id: number, name: string, args: Record<string, unknown> = {}): Promise<JsonRpcResponse> =>
  handleMcpRequest({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, caller)

const textOf = (response: JsonRpcResponse): string =>
  'result' in response ? JSON.stringify(response.result) : JSON.stringify(response)

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  await registry.register({ name: 'echo', type: 'stdio', command: 'npx', args: ['tsx', fixture] })
}, 30000)

afterAll(async () => {
  await registry.unregister('echo')
  await closeDb()
})

beforeEach(() => {
  clearReadCache()
})

describe('read-only tool cache (end to end through the router)', () => {
  it('serves a repeated read tool call from cache', async () => {
    const first = await callTool(1, 'echo__get_counter')
    const second = await callTool(2, 'echo__get_counter')

    expect(textOf(second)).toBe(textOf(first))
    expect(readCacheSize()).toBe(1)
  })

  it('queries the upstream again after the cache is cleared', async () => {
    const first = await callTool(3, 'echo__get_counter')
    clearReadCache()
    const fresh = await callTool(4, 'echo__get_counter')

    expect(textOf(fresh)).not.toBe(textOf(first))
  })

  it('does not cache tools whose name is not read-only', async () => {
    await callTool(5, 'echo__echo', { text: 'hi' })
    expect(readCacheSize()).toBe(0)
  })
})