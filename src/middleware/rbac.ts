import type { NextFunction, Request, Response } from 'express'
import { callToolParamsSchema } from '../http/jsonrpc'
import { isToolAllowed } from '../services/access'

export const rbacMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const caller = req.caller
  if (caller === undefined) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const body: unknown = req.body
  if (typeof body !== 'object' || body === null || !('method' in body)) {
    next()
    return
  }

  const method = (body as { method: unknown }).method
  if (method !== 'tools/call') {
    next()
    return
  }

  const rawParams = (body as { params?: unknown }).params
  const parsed = callToolParamsSchema.safeParse(rawParams)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tools/call parameters' })
    return
  }

  if (!isToolAllowed(caller, parsed.data.name)) {
    res.status(403).json({ error: `Forbidden tool: ${parsed.data.name}` })
    return
  }

  next()
}