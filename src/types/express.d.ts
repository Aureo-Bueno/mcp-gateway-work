import type { Logger } from 'pino'
import type { CallerContext } from './index'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      logger: Logger
      caller?: CallerContext
    }
  }
}

export {}