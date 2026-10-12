import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import swaggerUi from 'swagger-ui-express'
import { logger } from '../logger'
import { requireAdmin } from '../middleware/adminAuth'
import { authMiddleware } from '../middleware/auth'
import { errorHandler, notFoundHandler } from '../middleware/errorHandler'
import { corsMiddleware } from '../middleware/cors'
import { metricsRegistry } from '../services/metrics'
import type { RateLimiter } from '../services/rateLimiter'
import { adminRoutes } from './adminRoutes'
import { createMcpRouter } from './mcpRoute'
import { openApiDocument } from './openapi'
import { panelHtml } from './panel'

export const createApp = (limiter: RateLimiter): Express => {
  const app = express()

  app.use(corsMiddleware)
  app.use(express.json({ limit: '5mb' }))
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.logger = logger
    next()
  })

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiDocument)
  })
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

  app.get('/metrics', authMiddleware, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Content-Type', metricsRegistry.contentType)
    res.send(await metricsRegistry.metrics())
  })

  app.get('/panel', (_req: Request, res: Response) => {
    res.type('html').send(panelHtml)
  })

  app.use('/mcp', createMcpRouter(limiter))
  app.use('/admin', authMiddleware, requireAdmin, adminRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}