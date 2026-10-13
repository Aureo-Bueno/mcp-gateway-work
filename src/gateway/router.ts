import type { Client } from '@modelcontextprotocol/sdk/client'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types'
import type {
  CallerContext,
  CatalogTool,
  GetPromptParams,
  JsonRpcRequestInput,
  JsonRpcResponse,
  ReadResourceParams,
  ToolCallParams,
} from '../types/index'
import {
  callToolParamsSchema,
  errorResponse,
  getPromptParamsSchema,
  readResourceParamsSchema,
  resultResponse,
} from '../http/jsonrpc'
import { safeRecordAudit } from '../services/auditLog'
import { approvalsTotal, recordToolCall, redactionsTotal, toolCacheTotal } from '../services/metrics'
import { isToolAllowed } from '../services/access'
import { createApproval, requiresApproval, waitForDecision } from '../services/approvals'
import { redactToolResult, type RedactionSummary } from '../services/redaction'
import { getCached, isReadOnlyTool, makeCacheKey, setCached } from '../services/readCache'
import { getEnv } from '../config/env'
import { logger } from '../logger'
import { resolveAuditTarget } from './auditTarget'
import {
  buildCatalog,
  findCatalogPrompt,
  findCatalogTool,
  listWirePrompts,
  listWireResourceTemplates,
  listWireResources,
  parseExposedResourceUri,
  toWireTool,
} from './catalog'
import { GATEWAY_SERVER_INFO, MCP_PROTOCOL_VERSION } from './constants'
import { registry } from './registry'

/** JSON-RPC error codes used by the gateway. */
export const JSON_RPC_ERRORS = {
  invalidParams: -32602,
  methodNotFound: -32601,
  internal: -32603,
  forbidden: -32003,
  notApproved: -32004,
} as const

const negotiateProtocolVersion = (requested: unknown): string => {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested
  }
  return MCP_PROTOCOL_VERSION
}

const initialize = (request: JsonRpcRequestInput): JsonRpcResponse => {
  return resultResponse(request.id ?? null, {
    protocolVersion: negotiateProtocolVersion(request.params?.['protocolVersion']),
    capabilities: { tools: {}, resources: {}, prompts: {} },
    serverInfo: GATEWAY_SERVER_INFO,
  })
}

const listTools = (request: JsonRpcRequestInput, caller: CallerContext): JsonRpcResponse => {
  const tools = buildCatalog()
    .filter((tool) => isToolAllowed(caller, tool.name))
    .map(toWireTool)

  return resultResponse(request.id ?? null, { tools })
}

const redact = <T>(value: T): { result: T; summary: RedactionSummary } => {
  const env = getEnv()
  return redactToolResult(value, { enabled: env.REDACTION_ENABLED, replacement: env.REDACTION_REPLACEMENT })
}

const countRedactions = (summary: RedactionSummary, context: Record<string, unknown>, message: string): void => {
  if (summary.total === 0) {
    return
  }
  for (const [rule, count] of Object.entries(summary.hits)) {
    redactionsTotal.inc({ rule }, count)
  }
  logger.warn({ ...context, hits: summary.hits, total: summary.total }, message)
}

const callTool = async (
  request: JsonRpcRequestInput,
  params: ToolCallParams,
  caller: CallerContext,
  catalogTool: CatalogTool
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const env = getEnv()
  const cacheable = env.READ_CACHE_ENABLED && isReadOnlyTool(catalogTool.originalName)
  const cacheKey = cacheable
    ? makeCacheKey(catalogTool.server, catalogTool.originalName, params.arguments)
    : undefined

  const audit = (response: unknown, latencyMs: number, status: 'success' | 'error'): Promise<void> =>
    safeRecordAudit({
      userId: caller.userId,
      method: 'tools/call',
      serverName: catalogTool.server,
      toolName: catalogTool.name,
      request: params,
      response,
      latencyMs,
      status,
    })

  if (cacheKey !== undefined) {
    const cached = getCached(cacheKey)
    if (cached.hit) {
      toolCacheTotal.inc({ server: catalogTool.server, result: 'hit' })
      await audit(cached.value, 0, 'success')
      return resultResponse(id, cached.value)
    }
    toolCacheTotal.inc({ server: catalogTool.server, result: 'miss' })
  }

  const startedAt = Date.now()
  let rawResult: Awaited<ReturnType<Client['callTool']>>

  try {
    const server = registry.get(catalogTool.server)
    rawResult = await server.client.callTool({
      name: catalogTool.originalName,
      arguments: params.arguments,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const latencyMs = Date.now() - startedAt
    recordToolCall(catalogTool.server, catalogTool.name, 'error', latencyMs / 1000)
    await audit({ error: message }, latencyMs, 'error')
    return errorResponse(id, JSON_RPC_ERRORS.internal, `Tool execution failed: ${message}`)
  }

  const latencyMs = Date.now() - startedAt
  const { result, summary } = redact(rawResult)
  const status = rawResult.isError === true ? 'error' : 'success'

  countRedactions(
    summary,
    { server: catalogTool.server, tool: catalogTool.name },
    'Redacted sensitive data from tool response'
  )
  recordToolCall(catalogTool.server, catalogTool.name, status, latencyMs / 1000)

  if (cacheKey !== undefined && status === 'success') {
    setCached(cacheKey, result, env.READ_CACHE_TTL_SECONDS, env.READ_CACHE_MAX_ENTRIES)
  }

  await audit(result, latencyMs, status)
  return resultResponse(id, result)
}

const withApproval = async (
  request: JsonRpcRequestInput,
  params: ToolCallParams,
  caller: CallerContext,
  catalogTool: CatalogTool
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const ttlMs = getEnv().APPROVAL_TIMEOUT_SECONDS * 1000
  const approval = await createApproval({
    userId: caller.userId,
    userName: caller.userName,
    serverName: catalogTool.server,
    toolName: params.name,
    args: params.arguments,
    ttlMs,
  })

  approvalsTotal.inc({ status: 'pending' })
  logger.info(
    { approvalId: approval.id, tool: params.name, user: caller.userName },
    'Tool call is awaiting human approval'
  )

  const decision = await waitForDecision(approval.id, ttlMs)
  approvalsTotal.inc({ status: decision })

  if (decision === 'approved') {
    return callTool(request, params, caller, catalogTool)
  }

  const finalStatus = decision === 'rejected' ? 'rejected' : 'expired'
  const message =
    finalStatus === 'rejected'
      ? `Tool call rejected by approver: ${params.name}`
      : `Tool call not approved before timeout: ${params.name}`

  await safeRecordAudit({
    userId: caller.userId,
    method: 'tools/call',
    serverName: catalogTool.server,
    toolName: catalogTool.name,
    request: params,
    response: { error: message, approvalId: approval.id },
    latencyMs: 0,
    status: finalStatus,
  })

  return errorResponse(id, JSON_RPC_ERRORS.notApproved, message, { approvalId: approval.id, status: finalStatus })
}

const handleToolCall = async (request: JsonRpcRequestInput, caller: CallerContext): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const parsed = callToolParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'Invalid tools/call parameters', parsed.error.flatten())
  }
  const params = parsed.data

  // Checked before the catalog lookup so callers cannot probe which tools exist.
  if (!isToolAllowed(caller, params.name)) {
    const target = resolveAuditTarget('tools/call', params)
    await safeRecordAudit({
      userId: caller.userId,
      method: 'tools/call',
      serverName: target?.serverName ?? 'unknown',
      toolName: params.name,
      request: params,
      response: { error: 'Forbidden tool' },
      latencyMs: 0,
      status: 'forbidden',
    })
    return errorResponse(id, JSON_RPC_ERRORS.forbidden, `Forbidden tool: ${params.name}`)
  }

  const catalogTool = findCatalogTool(params.name)
  if (catalogTool === undefined) {
    const target = resolveAuditTarget('tools/call', params)
    await safeRecordAudit({
      userId: caller.userId,
      method: 'tools/call',
      serverName: target?.serverName ?? 'unknown',
      toolName: params.name,
      request: params,
      response: { error: 'Unknown tool' },
      latencyMs: 0,
      status: 'unknown_tool',
    })
    return errorResponse(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool: ${params.name}`)
  }

  if (await requiresApproval(params.name)) {
    return withApproval(request, params, caller, catalogTool)
  }
  return callTool(request, params, caller, catalogTool)
}

export const handleMcpRequest = async (
  request: JsonRpcRequestInput,
  caller: CallerContext
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null

  switch (request.method) {
    case 'initialize':
      return initialize(request)

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return resultResponse(id, {})

    case 'ping':
      return resultResponse(id, {})

    case 'tools/list':
      return listTools(request, caller)

    case 'tools/call':
      return handleToolCall(request, caller)

    case 'resources/list':
      return resultResponse(id, { resources: listWireResources() })

    case 'resources/templates/list':
      return resultResponse(id, { resourceTemplates: listWireResourceTemplates() })

    case 'resources/read': {
      const parsed = readResourceParamsSchema.safeParse(request.params)
      if (!parsed.success) {
        return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'Invalid resources/read parameters', parsed.error.flatten())
      }
      return readResource(request, parsed.data, caller)
    }

    case 'prompts/list':
      return resultResponse(id, { prompts: listWirePrompts() })

    case 'prompts/get': {
      const parsed = getPromptParamsSchema.safeParse(request.params)
      if (!parsed.success) {
        return errorResponse(id, JSON_RPC_ERRORS.invalidParams, 'Invalid prompts/get parameters', parsed.error.flatten())
      }
      return getPrompt(request, parsed.data, caller)
    }

    default:
      return errorResponse(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${request.method}`)
  }
}

const readResource = async (
  request: JsonRpcRequestInput,
  params: ReadResourceParams,
  caller: CallerContext
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const parsed = parseExposedResourceUri(params.uri)

  const audit = (
    serverName: string,
    response: unknown,
    latencyMs: number,
    status: 'success' | 'error' | 'unknown_resource'
  ): Promise<void> =>
    safeRecordAudit({
      userId: caller.userId,
      method: 'resources/read',
      serverName,
      toolName: params.uri,
      request: params,
      response,
      latencyMs,
      status,
    })

  if (parsed === undefined || !registry.has(parsed.server)) {
    await audit(parsed?.server ?? 'unknown', { error: 'Unknown resource' }, 0, 'unknown_resource')
    return errorResponse(id, JSON_RPC_ERRORS.invalidParams, `Unknown resource: ${params.uri}`)
  }

  const server = registry.get(parsed.server)
  const startedAt = Date.now()
  let rawResult: Awaited<ReturnType<Client['readResource']>>

  try {
    rawResult = await server.client.readResource({ uri: parsed.uri })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await audit(server.name, { error: message }, Date.now() - startedAt, 'error')
    return errorResponse(id, JSON_RPC_ERRORS.internal, `Resource read failed: ${message}`)
  }

  const latencyMs = Date.now() - startedAt
  const { result, summary } = redact(rawResult)
  countRedactions(summary, { server: server.name, resource: parsed.uri }, 'Redacted sensitive data from resource contents')

  await audit(server.name, result, latencyMs, 'success')
  return resultResponse(id, result)
}

const getPrompt = async (
  request: JsonRpcRequestInput,
  params: GetPromptParams,
  caller: CallerContext
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const catalogPrompt = findCatalogPrompt(params.name)

  const audit = (
    serverName: string,
    response: unknown,
    latencyMs: number,
    status: 'success' | 'error' | 'unknown_prompt'
  ): Promise<void> =>
    safeRecordAudit({
      userId: caller.userId,
      method: 'prompts/get',
      serverName,
      toolName: params.name,
      request: params,
      response,
      latencyMs,
      status,
    })

  if (catalogPrompt === undefined) {
    const target = resolveAuditTarget('prompts/get', params)
    await audit(target?.serverName ?? 'unknown', { error: 'Unknown prompt' }, 0, 'unknown_prompt')
    return errorResponse(id, JSON_RPC_ERRORS.invalidParams, `Unknown prompt: ${params.name}`)
  }

  const server = registry.get(catalogPrompt.server)
  const startedAt = Date.now()
  let rawResult: Awaited<ReturnType<Client['getPrompt']>>

  try {
    rawResult = await server.client.getPrompt({
      name: catalogPrompt.originalName,
      arguments: params.arguments,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await audit(server.name, { error: message }, Date.now() - startedAt, 'error')
    return errorResponse(id, JSON_RPC_ERRORS.internal, `Prompt resolution failed: ${message}`)
  }

  const latencyMs = Date.now() - startedAt
  const { result, summary } = redact(rawResult)
  countRedactions(
    summary,
    { server: server.name, prompt: catalogPrompt.originalName },
    'Redacted sensitive data from prompt response'
  )

  await audit(server.name, result, latencyMs, 'success')
  return resultResponse(id, result)
}
