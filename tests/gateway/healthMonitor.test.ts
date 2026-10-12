import path from 'node:path'
import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { registry } from '../../src/gateway/registry'
import { runHealthChecks } from '../../src/gateway/healthMonitor'
import { getHealth, listHealth, removeHealth } from '../../src/services/health'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')

const registerEcho = (): Promise<unknown> =>
  registry.register({ name: 'echo', type: 'stdio', command: 'npx', args: ['tsx', fixture] })

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  await registerEcho()
}, 30000)

afterAll(async () => {
  removeHealth('echo')
  await registry.unregister('echo')
  await closeDb()
})

describe('upstream health monitor', () => {
  it('records a healthy status after checking a reachable upstream', async () => {
    const summary = await runHealthChecks()

    expect(summary.checked).toBe(1)
    expect(summary.healthy).toBe(1)
    expect(summary.unhealthy).toBe(0)

    const health = getHealth('echo')
    expect(health?.healthy).toBe(true)
    expect(typeof health?.latencyMs).toBe('number')
    expect(typeof health?.checkedAt).toBe('string')
  })

  it('prunes health records for servers that are no longer registered', async () => {
    await runHealthChecks()
    expect(getHealth('echo')).toBeDefined()

    await registry.unregister('echo')
    const summary = await runHealthChecks()

    expect(summary.checked).toBe(0)
    expect(listHealth().some((entry) => entry.name === 'echo')).toBe(false)

    await registerEcho()
  })
})