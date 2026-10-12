import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import {
  deleteServerRecord,
  listServerConfigs,
  saveServer,
} from '../../src/services/serverStore'

const HTTP_NAME = 'jest-http'
const STDIO_NAME = 'jest-stdio'

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
})

afterAll(async () => {
  await deleteServerRecord(HTTP_NAME)
  await deleteServerRecord(STDIO_NAME)
  await closeDb()
})

describe('serverStore', () => {
  it('persists and restores http headers', async () => {
    await saveServer({
      name: HTTP_NAME,
      type: 'http',
      url: 'http://example.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    })

    const found = (await listServerConfigs()).find((c) => c.name === HTTP_NAME)
    expect(found).toBeDefined()
    expect(found?.type).toBe('http')
    if (found?.type === 'http') {
      expect(found.url).toBe('http://example.com/mcp')
      expect(found.headers).toEqual({ Authorization: 'Bearer secret' })
    }
  })

  it('persists and restores stdio args and env', async () => {
    await saveServer({
      name: STDIO_NAME,
      type: 'stdio',
      command: 'node',
      args: ['-y', 'server.js'],
      env: { TOKEN: 'abc' },
    })

    const found = (await listServerConfigs()).find((c) => c.name === STDIO_NAME)
    expect(found).toBeDefined()
    if (found?.type === 'stdio') {
      expect(found.command).toBe('node')
      expect(found.args).toEqual(['-y', 'server.js'])
      expect(found.env).toEqual({ TOKEN: 'abc' })
    }
  })

  it('replaces the record on re-save (upsert)', async () => {
    await saveServer({ name: STDIO_NAME, type: 'stdio', command: 'node', args: [] })
    const matches = (await listServerConfigs()).filter((c) => c.name === STDIO_NAME)
    expect(matches).toHaveLength(1)
    if (matches[0]?.type === 'stdio') {
      expect(matches[0].args).toEqual([])
    }
  })

  it('removes a record', async () => {
    expect(await deleteServerRecord(HTTP_NAME)).toBe(true)
    expect((await listServerConfigs()).some((c) => c.name === HTTP_NAME)).toBe(false)
    expect(await deleteServerRecord(HTTP_NAME)).toBe(false)
  })
})
