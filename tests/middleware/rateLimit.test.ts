import { desc, eq } from 'drizzle-orm'
import express, { type NextFunction, type Request, type Response } from 'express'
import request from 'supertest'
import { getEnv } from '../../src/config/env'
import { closeDb, getDb, initDb } from '../../src/db/client'
import { auditLogs } from '../../src/db/schema'
import { createRateLimitMiddleware, rateLimitKey } from '../../src/middleware/rateLimit'
import { RateLimiter, type RateLimitDecision } from '../../src/services/rateLimiter'
import type { CallerContext } from '../../src/types/index'

const caller: CallerContext = {
  userId: 1,
  userName: 'admin',
  profile: 'admin',
  keyPrefix: 'mcp_testkey1',
  allowedPatterns: ['*'],
}

const TOOL = `rl${Date.now()}__echo`

class FakeLimiter {
  readonly keys: string[] = []
  constructor(private readonly decide: (call: number) => RateLimitDecision) {}

  async consume(key: string): Promise<RateLimitDecision> {
    this.keys.push(key)
    return this.decide(this.keys.length)
  }
}

const buildApp = (limiter: FakeLimiter) => {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.caller = caller
    next()
  })
  app.post('/mcp', createRateLimitMiddleware(limiter as unknown as RateLimiter), (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

const allow: RateLimitDecision = { allowed: true, remaining: 10, msBeforeNext: 0 }

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
})

afterAll(async () => {
  await getDb().delete(auditLogs).where(eq(auditLogs.toolName, TOOL))
  await closeDb()
})

describe('rate limit middleware', () => {
  it('uses one budget per user, whatever the method or tool name', async () => {
    const limiter = new FakeLimiter(() => allow)
    const app = buildApp(limiter)

    await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'a__x' } })
    await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'b__y' } })
    await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 3, method: `made-up-${Date.now()}` })

    expect(new Set(limiter.keys)).toEqual(new Set([rateLimitKey(caller.userId)]))
  })

  it('answers 429 and audits the rejected tool call', async () => {
    const limiter = new FakeLimiter(() => ({ allowed: false, remaining: 0, msBeforeNext: 3000 }))
    const response = await request(buildApp(limiter))
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL, arguments: { password: 'x' } } })

    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBe('3')

    const rows = await getDb().select().from(auditLogs).where(eq(auditLogs.toolName, TOOL)).orderBy(desc(auditLogs.id))
    expect(rows[0]?.status).toBe('rate_limited')
    expect(JSON.stringify(rows[0]?.requestJson)).not.toContain('"x"')
  })

  it('answers 503 (deny) when no limiter backend is available', async () => {
    const limiter = new FakeLimiter(() => ({ allowed: false, remaining: 0, msBeforeNext: 1000, unavailable: true }))
    const response = await request(buildApp(limiter)).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(response.status).toBe(503)
  })
})

describe('RateLimiter', () => {
  it('shares the budget in Redis', async () => {
    const limiter = new RateLimiter({ points: 2, duration: 60 })
    const key = `test-shared-${Date.now()}`
    try {
      expect((await limiter.consume(key)).allowed).toBe(true)
      expect((await limiter.consume(key)).allowed).toBe(true)
      expect((await limiter.consume(key)).allowed).toBe(false)
    } finally {
      await limiter.close()
    }
  })

  it('keeps limiting in memory when Redis is unreachable instead of failing open', async () => {
    const limiter = new RateLimiter({ redisUrl: 'redis://127.0.0.1:1', points: 2, duration: 60 })
    const key = `test-insurance-${Date.now()}`
    try {
      expect((await limiter.consume(key)).allowed).toBe(true)
      expect((await limiter.consume(key)).allowed).toBe(true)
      const third = await limiter.consume(key)
      expect(third.allowed).toBe(false)
      expect(third.unavailable).toBeUndefined()
    } finally {
      await limiter.close()
    }
  })
})
