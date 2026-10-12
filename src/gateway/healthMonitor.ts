import { logger } from '../logger'
import {
  upstreamHealthy,
  upstreamPingDuration,
  upstreamPingFailuresTotal,
} from '../services/metrics'
import { listHealth, recordHealth, removeHealth } from '../services/health'
import { registry } from './registry'

export interface HealthCheckSummary {
  checked: number
  healthy: number
  unhealthy: number
}

let timer: ReturnType<typeof setInterval> | null = null
let checking = false

export const runHealthChecks = async (): Promise<HealthCheckSummary> => {
  if (checking) {
    return { checked: 0, healthy: 0, unhealthy: 0 }
  }
  checking = true

  const servers = registry.list()
  const registeredNames = new Set(servers.map((server) => server.name))
  let healthy = 0
  let unhealthy = 0

  for (const server of servers) {
    const startedAt = Date.now()
    try {
      await server.client.ping()
      const latencyMs = Date.now() - startedAt
      recordHealth({
        name: server.name,
        healthy: true,
        latencyMs,
        checkedAt: new Date().toISOString(),
      })
      upstreamHealthy.set({ server: server.name }, 1)
      upstreamPingDuration.observe({ server: server.name }, latencyMs / 1000)
      healthy += 1
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      recordHealth({
        name: server.name,
        healthy: false,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      upstreamHealthy.set({ server: server.name }, 0)
      upstreamPingFailuresTotal.inc({ server: server.name })
      unhealthy += 1
    }
  }

  for (const health of listHealth()) {
    if (!registeredNames.has(health.name)) {
      removeHealth(health.name)
      upstreamHealthy.remove({ server: health.name })
    }
  }

  checking = false
  logger.debug({ checked: servers.length, healthy, unhealthy }, 'Upstream health check completed')
  return { checked: servers.length, healthy, unhealthy }
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