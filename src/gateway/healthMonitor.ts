import { logger } from '../logger'
import {
  upstreamHealthy,
  upstreamPingDuration,
  upstreamPingFailuresTotal,
} from '../services/metrics'
import { listHealth, recordHealth, removeHealth } from '../services/health'
import { clearReadCache } from '../services/readCache'
import { registry } from './registry'

export interface HealthCheckSummary {
  checked: number
  healthy: number
  unhealthy: number
  /** Servers whose session was (re)opened during this check. */
  reconnected: number
}

let timer: ReturnType<typeof setInterval> | null = null
let checking = false

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const markHealthy = (name: string, latencyMs: number): void => {
  recordHealth({ name, healthy: true, latencyMs, checkedAt: new Date().toISOString() })
  upstreamHealthy.set({ server: name }, 1)
  upstreamPingDuration.observe({ server: name }, latencyMs / 1000)
}

const markUnhealthy = (name: string, latencyMs: number, error: string): void => {
  recordHealth({ name, healthy: false, latencyMs, checkedAt: new Date().toISOString(), error })
  upstreamHealthy.set({ server: name }, 0)
  upstreamPingFailuresTotal.inc({ server: name })
}

/**
 * Pings every connected upstream. When a ping fails, the gateway closes that
 * session and opens a new one; servers that could not be connected (at startup
 * or after a failed reconnect) are retried on every run.
 */
export const runHealthChecks = async (): Promise<HealthCheckSummary> => {
  if (checking) {
    return { checked: 0, healthy: 0, unhealthy: 0, reconnected: 0 }
  }
  checking = true

  try {
    const summary: HealthCheckSummary = { checked: 0, healthy: 0, unhealthy: 0, reconnected: 0 }
    const attempted = new Set<string>()

    for (const server of registry.list()) {
      attempted.add(server.name)
      summary.checked += 1
      const startedAt = Date.now()
      try {
        await server.client.ping()
        markHealthy(server.name, Date.now() - startedAt)
        summary.healthy += 1
        continue
      } catch (error) {
        logger.warn({ server: server.name, err: errorMessage(error) }, 'Upstream ping failed; reconnecting')
      }

      const reconnectStartedAt = Date.now()
      try {
        await registry.reconnect(server.name)
        clearReadCache(server.name)
        markHealthy(server.name, Date.now() - reconnectStartedAt)
        summary.healthy += 1
        summary.reconnected += 1
        logger.info({ server: server.name }, 'Reconnected upstream MCP server')
      } catch (error) {
        markUnhealthy(server.name, Date.now() - startedAt, errorMessage(error))
        summary.unhealthy += 1
        logger.error({ server: server.name, err: errorMessage(error) }, 'Failed to reconnect upstream MCP server')
      }
    }

    const pending = registry
      .listFailed()
      .filter((entry) => !attempted.has(entry.name) && !registry.has(entry.name))
    for (const entry of pending) {
      summary.checked += 1
      const startedAt = Date.now()
      try {
        await registry.connect(entry.config)
        clearReadCache(entry.name)
        markHealthy(entry.name, Date.now() - startedAt)
        summary.healthy += 1
        summary.reconnected += 1
        logger.info({ server: entry.name }, 'Connected upstream MCP server after retry')
      } catch (error) {
        markUnhealthy(entry.name, Date.now() - startedAt, errorMessage(error))
        summary.unhealthy += 1
      }
    }

    const knownNames = new Set([
      ...registry.list().map((server) => server.name),
      ...registry.listFailed().map((entry) => entry.name),
    ])
    for (const health of listHealth()) {
      if (!knownNames.has(health.name)) {
        removeHealth(health.name)
        upstreamHealthy.remove({ server: health.name })
      }
    }

    logger.debug(summary, 'Upstream health check completed')
    return summary
  } finally {
    checking = false
  }
}

export const startHealthMonitor = (intervalSeconds: number): void => {
  if (timer !== null) {
    return
  }
  void runHealthChecks()
  timer = setInterval(() => void runHealthChecks(), Math.max(1, intervalSeconds) * 1000)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

export const stopHealthMonitor = (): void => {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
