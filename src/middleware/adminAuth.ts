import type { NextFunction, Request, Response } from 'express'

export const ADMIN_PROFILE = 'admin'

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const caller = req.caller
  if (caller === undefined) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  if (caller.profile !== ADMIN_PROFILE) {
    res.status(403).json({ error: 'Administrator privileges required' })
    return
  }

  next()
}
