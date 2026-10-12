import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

export const metricsRegistry = new Registry()

collectDefaultMetrics({ register: metricsRegistry })

export const httpRequestsTotal = new Counter({
  name: 'mcp_gateway_http_requests_total',
  help: 'Total JSON-RPC requests received on /mcp, by method.',
  labelNames: ['method'],
  registers: [metricsRegistry],
})

export const authFailuresTotal = new Counter({
  name: 'mcp_gateway_auth_failures_total',
  help: 'Total authentication failures.',
  labelNames: ['reason'],
  registers: [metricsRegistry],
})

export const rateLimitRejectionsTotal = new Counter({
  name: 'mcp_gateway_rate_limit_rejections_total',
  help: 'Total requests rejected by the rate limiter.',
  labelNames: ['scope'],
  registers: [metricsRegistry],
})

export const toolCallsTotal = new Counter({
  name: 'mcp_gateway_tool_calls_total',
  help: 'Total upstream tool calls, by server, tool and status.',
  labelNames: ['server', 'tool', 'status'],
  registers: [metricsRegistry],
})

export const approvalsTotal = new Counter({
  name: 'mcp_gateway_approvals_total',
  help: 'Total human approval decisions, by status.',
  labelNames: ['status'],
  registers: [metricsRegistry],
})

export const redactionsTotal = new Counter({
  name: 'mcp_gateway_tool_redactions_total',
  help: 'Total sensitive values redacted from tool responses, by rule.',
  labelNames: ['rule'],
  registers: [metricsRegistry],
})

export const upstreamHealthy = new Gauge({
  name: 'mcp_gateway_upstream_healthy',
  help: 'Whether an upstream MCP server is healthy (1) or not (0), by server.',
  labelNames: ['server'],
  registers: [metricsRegistry],
})

export const upstreamPingDuration = new Histogram({
  name: 'mcp_gateway_upstream_ping_duration_seconds',
  help: 'Duration of upstream ping (health) checks in seconds, by server.',
  labelNames: ['server'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
})

export const upstreamPingFailuresTotal = new Counter({
  name: 'mcp_gateway_upstream_ping_failures_total',
  help: 'Total failed upstream ping (health) checks, by server.',
  labelNames: ['server'],
  registers: [metricsRegistry],
})

export const toolCacheTotal = new Counter({
  name: 'mcp_gateway_tool_cache_total',
  help: 'Read-only tool cache lookups, by server and result (hit or miss).',
  labelNames: ['server', 'result'],
  registers: [metricsRegistry],
})

export const toolCallDuration = new Histogram({
  name: 'mcp_gateway_tool_call_duration_seconds',
  help: 'Duration of upstream tool calls in seconds.',
  labelNames: ['server', 'tool'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
})

export const recordToolCall = (
  server: string,
  tool: string,
  status: 'success' | 'error',
  durationSeconds: number
): void => {
  toolCallsTotal.inc({ server, tool, status })
  toolCallDuration.observe({ server, tool }, durationSeconds)
}
