import type { NextFunction, Request, Response } from 'express'
import { authenticateApiKey } from '../services/apiKeys'
import { authFailuresTotal } from '../services/metrics'

const extractApiKey = (req: Request): string | undefined => {
  const headerKey = req.header('x-api-key')
  if (headerKey !== undefined && headerKey.length > 0) {
    return headerKey
  }

  const authorization = req.header('authorization')
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length)
  }

  return undefined
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const apiKey = extractApiKey(req)
  if (apiKey === undefined) {
    authFailuresTotal.inc({ reason: 'missing' })
    res.status(401).json({ error: 'API key missing' })
    return
  }

  const caller = await authenticateApiKey(apiKey)
  if (caller === null) {
    authFailuresTotal.inc({ reason: 'invalid' })
    res.status(401).json({ error: 'Invalid, expired or revoked API key' })
    return
  }

  req.caller = caller
  next()
}
