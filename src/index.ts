import { getEnv } from './config/env'
import { loadGatewayConfig } from './config/servers'
import { closeDb, initDb } from './db/client'
import { registry } from './gateway/registry'
import { startHealthMonitor, stopHealthMonitor } from './gateway/healthMonitor'
import { createApp } from './http/app'
import { logger } from './logger'
import { RateLimiter } from './services/rateLimiter'
import { countServers, listServerConfigs, saveServer } from './services/serverStore'

const main = async (): Promise<void> => {
  const env = getEnv()

  await initDb(env.DATABASE_URL)

  if ((await countServers()) === 0) {
    const fileConfig = loadGatewayConfig(env.GATEWAY_CONFIG)
    for (const config of fileConfig.servers) {
      await saveServer(config)
    }
    if (fileConfig.servers.length > 0) {
      logger.info({ count: fileConfig.servers.length, path: env.GATEWAY_CONFIG }, 'Seeded servers from config file')
    }
  }

  const config = await listServerConfigs()
  const connection = await registry.connectAll(config)

  if (connection.connected.length > 0) {
    logger.info({ servers: connection.connected }, 'Connected upstream MCP servers')
  }
  for (const failure of connection.failed) {
    logger.error({ server: failure.name, err: failure.error }, 'Failed to connect upstream MCP server')
  }

  startHealthMonitor(env.HEALTH_CHECK_INTERVAL_SECONDS)

  const limiter = new RateLimiter()
  const app = createApp(limiter)

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'MCP Gateway listening')
  })

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down')
    stopHealthMonitor()
    server.close()
    await registry.disconnectAll()
    await limiter.close()
    await closeDb()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal startup error')
  process.exit(1)
})