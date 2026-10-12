import type { NextFunction, Request, Response } from 'express'
import { getEnv } from '../config/env'

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-API-Key'

export const corsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const origin = getEnv().CORS_ORIGIN

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')

  if (origin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  res.setHeader('Access-Control-Max-Age', '86400')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
}
