import type { NextFunction, Request, Response } from 'express'
import { callToolParamsSchema } from '../http/jsonrpc'
import { rateLimitRejectionsTotal } from '../services/metrics'
import type { RateLimiter } from '../services/rateLimiter'

const resolveScope = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('method' in body)) {
    return 'unknown'
  }

  const method = (body as { method: unknown }).method
  if (typeof method !== 'string') {
    return 'unknown'
  }

  if (method === 'tools/call') {
    const parsed = callToolParamsSchema.safeParse((body as { params?: unknown }).params)
    if (parsed.success) {
      return `tools/call:${parsed.data.name}`
    }
  }

  return method
}

export const createRateLimitMiddleware =
  (limiter: RateLimiter) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const caller = req.caller
    if (caller === undefined) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }

    const scope = resolveScope(req.body)
    const decision = await limiter.consume(`${caller.keyPrefix}:${scope}`)

    res.setHeader('X-RateLimit-Remaining', decision.remaining)

    if (!decision.allowed) {
      rateLimitRejectionsTotal.inc({ scope })
      res.setHeader('Retry-After', Math.ceil(decision.msBeforeNext / 1000))
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    next()
  }