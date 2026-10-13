import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { serverConfigSchema } from '../config/servers'
import { buildCatalog } from '../gateway/catalog'
import { registry } from '../gateway/registry'
import { runHealthChecks } from '../gateway/healthMonitor'
import { AppError } from '../middleware/errorHandler'
import { listAuditLogs } from '../services/auditLog'
import {
  createApiKey,
  createProfile,
  createUser,
  listApiKeys,
  listProfiles,
  listUsers,
  replaceProfileTools,
  revokeApiKey,
} from '../services/credentials'
import { deleteServerRecord, getServerConfig, listServerRecords, saveServer } from '../services/serverStore'
import { getHealth, listHealth, removeHealth } from '../services/health'
import { clearReadCache } from '../services/readCache'
import { metricsRegistry } from '../services/metrics'
import {
  createApprovalRule,
  decideApproval,
  deleteApprovalRule,
  listApprovalRules,
  listApprovals,
} from '../services/approvals'

export const adminRoutes = Router()

const createApiKeySchema = z.object({
  userName: z.string().min(1),
  expiresInDays: z.coerce.number().int().positive().max(3650).default(365),
})

const createUserSchema = z.object({
  name: z.string().min(1),
  profile: z.string().min(1),
})

const createProfileSchema = z.object({
  name: z.string().min(1),
  patterns: z.array(z.string().min(1)).default([]),
})

const updateProfileToolsSchema = z.object({
  patterns: z.array(z.string().min(1)),
})

const createApprovalRuleSchema = z.object({
  pattern: z.string().min(1),
  enabled: z.boolean().default(true),
})

const badRequest = (res: Response, error: z.ZodError): void => {
  res.status(400).json({ error: 'Invalid request body', details: error.flatten() })
}

adminRoutes.get('/servers', async (_req: Request, res: Response): Promise<void> => {
  const records = await listServerRecords()
  res.json(
    records.map((record) => {
      const connected = registry.has(record.name)
      const health = getHealth(record.name)
      const failure = registry.getFailure(record.name)
      return {
        name: record.name,
        type: record.type,
        connected,
        toolCount: connected ? registry.get(record.name).tools.length : 0,
        lastError: connected ? null : (failure?.error ?? null),
        connectAttempts: failure?.attempts ?? 0,
        healthy: health === undefined ? null : health.healthy,
        lastPingMs: health?.latencyMs ?? null,
        lastCheckAt: health?.checkedAt ?? null,
        createdAt: record.createdAt,
      }
    })
  )
})

adminRoutes.get('/health', (_req: Request, res: Response): void => {
  res.json(listHealth())
})

adminRoutes.post('/health/check', async (_req: Request, res: Response): Promise<void> => {
  res.json(await runHealthChecks())
})

adminRoutes.get('/catalog', (_req: Request, res: Response): void => {
  res.json(buildCatalog())
})

adminRoutes.get('/audit', async (req: Request, res: Response): Promise<void> => {
  const rawLimit = req.query['limit']
  const limit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : 100
  res.json(await listAuditLogs(Number.isNaN(limit) ? 100 : limit))
})

adminRoutes.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  res.json(await metricsRegistry.getMetricsAsJSON())
})

adminRoutes.get('/approvals', async (req: Request, res: Response): Promise<void> => {
  const rawLimit = req.query['limit']
  const limit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : 50
  res.json(await listApprovals(Number.isNaN(limit) ? 50 : limit))
})

adminRoutes.post(
  '/approvals/:id/approve',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid approval id' })
      return
    }
    const approval = await decideApproval(id, 'approved', req.caller?.userName ?? 'admin')
    if (approval === null) {
      res.status(404).json({ error: `Approval ${id} is not pending or has expired` })
      return
    }
    res.json(approval)
  }
)

adminRoutes.post(
  '/approvals/:id/reject',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const id = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid approval id' })
      return
    }
    const approval = await decideApproval(id, 'rejected', req.caller?.userName ?? 'admin')
    if (approval === null) {
      res.status(404).json({ error: `Approval ${id} is not pending or has expired` })
      return
    }
    res.json(approval)
  }
)

adminRoutes.get('/approval-rules', async (_req: Request, res: Response): Promise<void> => {
  res.json(await listApprovalRules())
})

adminRoutes.post('/approval-rules', async (req: Request, res: Response): Promise<void> => {
  const parsed = createApprovalRuleSchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(res, parsed.error)
    return
  }
  res.status(201).json(await createApprovalRule(parsed.data.pattern, parsed.data.enabled))
})

adminRoutes.delete('/approval-rules/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = Number.parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid rule id' })
    return
  }
  const removed = await deleteApprovalRule(id)
  if (!removed) {
    res.status(404).json({ error: `Rule ${id} not found` })
    return
  }
  res.json({ id, removed: true })
})

adminRoutes.get('/api-keys', async (_req: Request, res: Response): Promise<void> => {
  res.json(await listApiKeys())
})

adminRoutes.post('/api-keys', async (req: Request, res: Response): Promise<void> => {
  const parsed = createApiKeySchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(res, parsed.error)
    return
  }

  try {
    const created = await createApiKey(parsed.data.userName, parsed.data.expiresInDays)
    res.status(201).json({
      id: created.id,
      userName: created.userName,
      prefix: created.prefix,
      expiresAt: created.expiresAt,
      apiKey: created.key,
      warning: 'Store this key now; it cannot be recovered.',
    })
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Failed to create API key' })
  }
})

adminRoutes.delete('/api-keys/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = Number.parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid API key id' })
    return
  }

  const revoked = await revokeApiKey(id)
  if (!revoked) {
    res.status(404).json({ error: `API key ${id} not found` })
    return
  }

  res.json({ id, revoked: true })
})

adminRoutes.get('/users', async (_req: Request, res: Response): Promise<void> => {
  res.json(await listUsers())
})

adminRoutes.post('/users', async (req: Request, res: Response): Promise<void> => {
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(res, parsed.error)
    return
  }

  try {
    const user = await createUser(parsed.data.name, parsed.data.profile)
    res.status(201).json(user)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create user' })
  }
})

adminRoutes.get('/profiles', async (_req: Request, res: Response): Promise<void> => {
  res.json(await listProfiles())
})

adminRoutes.post('/profiles', async (req: Request, res: Response): Promise<void> => {
  const parsed = createProfileSchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(res, parsed.error)
    return
  }

  const profile = await createProfile(parsed.data.name, parsed.data.patterns)
  res.status(201).json(profile)
})

adminRoutes.put('/profiles/:name/tools', async (req: Request<{ name: string }>, res: Response): Promise<void> => {
  const parsed = updateProfileToolsSchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(res, parsed.error)
    return
  }

  try {
    await replaceProfileTools(req.params.name, parsed.data.patterns)
    res.json({ name: req.params.name, patterns: parsed.data.patterns })
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Failed to update profile' })
  }
})

adminRoutes.post('/servers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = serverConfigSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid server config', details: parsed.error.flatten() })
    return
  }

  if (registry.has(parsed.data.name)) {
    res.status(409).json({ error: `Server "${parsed.data.name}" is already registered` })
    return
  }

  try {
    const server = await registry.register(parsed.data)
    await saveServer(parsed.data)
    clearReadCache(parsed.data.name)
    res.status(201).json({ name: server.name, toolCount: server.tools.length, connected: true })
  } catch (error) {
    next(new AppError(error instanceof Error ? error.message : 'Failed to register server', 502))
  }
})

adminRoutes.delete(
  '/servers/:name',
  async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const name = req.params.name
    const disconnected = await registry.unregister(name)
    const removed = await deleteServerRecord(name)
    removeHealth(name)
    clearReadCache(name)

    if (!disconnected && !removed) {
      res.status(404).json({ error: `Server "${name}" is not registered` })
      return
    }

    res.json({ name, disconnected, removed })
  }
)

adminRoutes.post(
  '/servers/:name/refresh',
  async (req: Request<{ name: string }>, res: Response, next: NextFunction): Promise<void> => {
    const name = req.params.name

    if (registry.has(name)) {
      try {
        const tools = await registry.refreshTools(name)
        clearReadCache(name)
        res.json({ name, toolCount: tools.length, reconnected: false })
      } catch (error) {
        next(new AppError(error instanceof Error ? error.message : 'Failed to refresh tools', 502))
      }
      return
    }

    // Persisted but not connected (failed at startup or after a reconnect):
    // try to open a new session with the stored config.
    const config = await getServerConfig(name)
    if (config === null) {
      res.status(404).json({ error: `Server "${name}" is not registered` })
      return
    }

    try {
      const server = await registry.connect(config)
      clearReadCache(name)
      res.json({ name, toolCount: server.tools.length, reconnected: true })
    } catch (error) {
      next(new AppError(error instanceof Error ? error.message : 'Failed to connect server', 502))
    }
  }
)

adminRoutes.post(
  '/servers/:name/ping',
  async (req: Request<{ name: string }>, res: Response, next: NextFunction): Promise<void> => {
    const name = req.params.name
    if (!registry.has(name)) {
      res.status(404).json({ error: `Server "${name}" is not registered` })
      return
    }

    const startedAt = Date.now()
    try {
      await registry.ping(name)
      res.json({ name, ok: true, latencyMs: Date.now() - startedAt })
    } catch (error) {
      next(new AppError(error instanceof Error ? error.message : 'Ping failed', 502))
    }
  }
)
