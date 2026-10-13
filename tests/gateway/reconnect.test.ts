import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { runHealthChecks } from '../../src/gateway/healthMonitor'
import { registry } from '../../src/gateway/registry'
import { adminRoutes } from '../../src/http/adminRoutes'
import { errorHandler } from '../../src/middleware/errorHandler'
import { removeHealth } from '../../src/services/health'
import { clearReadCache, getCached, makeCacheKey, setCached } from '../../src/services/readCache'
import { deleteServerRecord, saveServer } from '../../src/services/serverStore'

const fixturesDir = path.resolve(__dirname, '../fixtures')
const echoFixture = path.join(fixturesDir, 'echo-server.ts')
const stamp = Date.now()

// Each test uses its own server names so it never collides with other suites.
const DEAD = `dead${stamp}`
const LATE = `late${stamp}`
const LATE_FILE = path.join(fixturesDir, `late-${stamp}.ts`)
const FLAKY = `flaky${stamp}`
const NEW = `new${stamp}`
const PERSISTED = `persisted${stamp}`
const PERSISTED_FILE = path.join(fixturesDir, `persisted-${stamp}.ts`)

const stdio = (name: string, file: string) => ({
  name,
  type: 'stdio' as const,
  command: 'npx',
  args: ['tsx', file],
})

const adminApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/admin', adminRoutes)
  app.use(errorHandler)
  return app
}

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
})

afterAll(async () => {
  for (const name of [DEAD, LATE, FLAKY, NEW, PERSISTED]) {
    removeHealth(name)
    await registry.unregister(name)
    await deleteServerRecord(name)
  }
  rmSync(LATE_FILE, { force: true })
  rmSync(PERSISTED_FILE, { force: true })
  await closeDb()
})

describe('upstream reconnection', () => {
  it('remembers servers that fail to connect at startup', async () => {
    const result = await registry.connectAll([stdio(DEAD, path.join(fixturesDir, 'missing.ts'))])

    expect(result.failed.map((failure) => failure.name)).toEqual([DEAD])
    expect(registry.has(DEAD)).toBe(false)
    expect(registry.getFailure(DEAD)?.attempts).toBe(1)

    expect(await registry.unregister(DEAD)).toBe(true)
    expect(registry.getFailure(DEAD)).toBeUndefined()
  }, 30000)

  it('connects a failed server on a later health check once it becomes available', async () => {
    await registry.connectAll([stdio(LATE, LATE_FILE)])
    expect(registry.has(LATE)).toBe(false)

    copyFileSync(echoFixture, LATE_FILE)
    const summary = await runHealthChecks()

    expect(summary.reconnected).toBeGreaterThanOrEqual(1)
    expect(registry.has(LATE)).toBe(true)
    expect(registry.getFailure(LATE)).toBeUndefined()
  }, 60000)

  it('reopens the session of a connected server whose ping fails', async () => {
    await registry.register(stdio(FLAKY, echoFixture))
    const original = registry.get(FLAKY).client
    await original.close()

    await runHealthChecks()

    expect(registry.has(FLAKY)).toBe(true)
    expect(registry.get(FLAKY).client).not.toBe(original)
    await expect(registry.ping(FLAKY)).resolves.toBeUndefined()
  }, 60000)
})

describe('admin server routes', () => {
  it('only invalidates the cache of the server being registered', async () => {
    clearReadCache()
    const otherKey = makeCacheKey(`other${stamp}`, 'get_thing', {})
    setCached(otherKey, { ok: true }, 60, 100)

    const response = await request(adminApp()).post('/admin/servers').send(stdio(NEW, echoFixture))

    expect(response.status).toBe(201)
    expect(getCached(otherKey).hit).toBe(true)
  }, 30000)

  it('refresh connects a persisted server that is not connected', async () => {
    await saveServer(stdio(PERSISTED, PERSISTED_FILE))
    await registry.connectAll([stdio(PERSISTED, PERSISTED_FILE)])
    expect(registry.has(PERSISTED)).toBe(false)

    const app = adminApp()
    const listed = await request(app).get('/admin/servers')
    const entry = (listed.body as Array<{ name: string; connected: boolean; lastError: string | null }>).find(
      (server) => server.name === PERSISTED
    )
    expect(entry?.connected).toBe(false)
    expect(entry?.lastError).not.toBeNull()

    copyFileSync(echoFixture, PERSISTED_FILE)
    const refreshed = await request(app).post(`/admin/servers/${PERSISTED}/refresh`)

    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toMatchObject({ name: PERSISTED, reconnected: true })
    expect(registry.has(PERSISTED)).toBe(true)
  }, 60000)
})
