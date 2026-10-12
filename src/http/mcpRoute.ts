import { Router, type NextFunction, type Request, type Response } from 'express'
import { handleMcpRequest } from '../gateway/router'
import { authMiddleware } from '../middleware/auth'
import { errorResponse, jsonRpcRequestSchema } from './jsonrpc'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { rbacMiddleware } from '../middleware/rbac'
import { httpRequestsTotal } from '../services/metrics'
import type { RateLimiter } from '../services/rateLimiter'

export const createMcpRouter = (limiter: RateLimiter): Router => {
  const router = Router()

  router.post(
    '/',
    authMiddleware,
    rbacMiddleware,
    createRateLimitMiddleware(limiter),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const caller = req.caller
      if (caller === undefined) {
        res.status(401).json({ error: 'Unauthenticated' })
        return
      }

      const parsed = jsonRpcRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        httpRequestsTotal.inc({ method: 'invalid' })
        res.status(400).json(errorResponse(null, -32700, 'Invalid JSON-RPC request'))
        return
      }

      httpRequestsTotal.inc({ method: parsed.data.method })

      try {
        const response = await handleMcpRequest(parsed.data, caller)
        res.json(response)
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}