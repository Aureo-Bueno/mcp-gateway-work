import type { NextFunction, Request, Response } from 'express'
import { logger } from '../logger'

export class AppError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` })
}

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = error instanceof AppError ? error.statusCode : 500
  const message = error instanceof Error ? error.message : 'Internal Server Error'

  const log = req.logger ?? logger
  if (statusCode >= 500) {
    log.error({ err: error }, 'Request failed')
  } else {
    log.warn({ err: error }, 'Request rejected')
  }

  res.status(statusCode).json({ error: message })
}