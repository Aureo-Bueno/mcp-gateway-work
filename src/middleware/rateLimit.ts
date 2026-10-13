import type { NextFunction, Request, Response } from 'express'
import { resolveAuditTarget } from '../gateway/auditTarget'
import { safeRecordAudit } from '../services/auditLog'
import { rateLimitRejectionsTotal } from '../services/metrics'
import type { RateLimiter } from '../services/rateLimiter'

const KNOWN_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
])

/** Bounded metric label: client-controlled method names are folded into "other". */
const methodLabel = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('method' in body)) {
    return 'unknown'
  }
  const method = (body as { method: unknown }).method
  if (typeof method !== 'string') {
    return 'unknown'
  }
  if (method.startsWith('notifications/')) {
    return 'notifications'
  }
  return KNOWN_METHODS.has(method) ? method : 'other'
}

/**
 * One budget per authenticated user, shared by every method, tool and API key
 * of that user. Changing the method or tool name does not open a new budget.
 */
export const rateLimitKey = (userId: number): string => `user:${userId}`

export const createRateLimitMiddleware =
  (limiter: RateLimiter) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const caller = req.caller
    if (caller === undefined) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }

    const decision = await limiter.consume(rateLimitKey(caller.userId))

    res.setHeader('X-RateLimit-Remaining', decision.remaining)

    if (decision.allowed) {
      next()
      return
    }

    const label = methodLabel(req.body)
    rateLimitRejectionsTotal.inc({ scope: label })

    const body = req.body as { method?: unknown; params?: unknown } | undefined
    const target = resolveAuditTarget(body?.method, body?.params)
    if (target !== undefined) {
      await safeRecordAudit({
        userId: caller.userId,
        method: target.method,
        serverName: target.serverName,
        toolName: target.toolName,
        request: target.request,
        response: { error: decision.unavailable === true ? 'Rate limiter unavailable' : 'Rate limit exceeded' },
        latencyMs: 0,
        status: 'rate_limited',
      })
    }

    res.setHeader('Retry-After', Math.max(1, Math.ceil(decision.msBeforeNext / 1000)))
    if (decision.unavailable === true) {
      res.status(503).json({ error: 'Rate limiter unavailable' })
      return
    }
    res.status(429).json({ error: 'Rate limit exceeded' })
  }
