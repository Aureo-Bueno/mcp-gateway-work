import path from 'node:path'
import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { registry } from '../../src/gateway/registry'
import { handleMcpRequest } from '../../src/gateway/router'
import type { CallerContext } from '../../src/types/index'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')

const caller: CallerContext = {
  userId: 1,
  userName: 'admin',
  profile: 'admin',
  keyPrefix: 'test',
  allowedPatterns: ['*'],
}

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  await registry.register({ name: 'echo', type: 'stdio', command: 'npx', args: ['tsx', fixture] })
}, 30000)

afterAll(async () => {
  await registry.unregister('echo')
  await closeDb()
})

describe('tool response redaction (end to end through the router)', () => {
  it('redacts secrets returned by an upstream tool', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo__leak', arguments: {} },
      },
      caller
    )

    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('sk-live0123456789abcdefGHIJ')
    expect(serialized).not.toContain('123.456.789-00')
    expect(serialized).not.toContain('4111 1111 1111 1111')
    expect(serialized).toContain('***')
  })

  it('leaves non-sensitive tool output untouched', async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo__echo', arguments: { text: 'hello' } },
      },
      caller
    )

    expect(JSON.stringify(response)).toContain('hello')
    expect(JSON.stringify(response)).not.toContain('***')
  })
})
