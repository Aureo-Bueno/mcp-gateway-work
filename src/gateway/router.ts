import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types'
import type {
  CallerContext,
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
import { recordAudit } from '../services/auditLog'
import { approvalsTotal, recordToolCall, redactionsTotal, toolCacheTotal } from '../services/metrics'
import { isToolAllowed } from '../services/access'
import { createApproval, requiresApproval, waitForDecision } from '../services/approvals'
import { redactToolResult } from '../services/redaction'
import { getCached, isReadOnlyTool, makeCacheKey, setCached } from '../services/readCache'
import { getEnv } from '../config/env'
import { logger } from '../logger'
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

const callTool = async (
  request: JsonRpcRequestInput,
  params: ToolCallParams,
  caller: CallerContext
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const catalogTool = findCatalogTool(params.name)

  if (catalogTool === undefined) {
    return errorResponse(id, -32602, `Unknown tool: ${params.name}`)
  }

  const env = getEnv()
  const cacheable = env.READ_CACHE_ENABLED && isReadOnlyTool(catalogTool.originalName)
  const cacheKey = cacheable
    ? makeCacheKey(catalogTool.server, catalogTool.originalName, params.arguments)
    : undefined

  if (cacheKey !== undefined) {
    const cached = getCached(cacheKey)
    if (cached.hit) {
      toolCacheTotal.inc({ server: catalogTool.server, result: 'hit' })
      await recordAudit({
        userId: caller.userId,
        serverName: catalogTool.server,
        toolName: catalogTool.name,
        request: params,
        response: cached.value,
        latencyMs: 0,
        status: 'success',
      })
      return resultResponse(id, cached.value)
    }
    toolCacheTotal.inc({ server: catalogTool.server, result: 'miss' })
  }

  const server = registry.get(catalogTool.server)
  const startedAt = Date.now()

  try {
    const rawResult = await server.client.callTool({
      name: catalogTool.originalName,
      arguments: params.arguments,
    })

    const { result, summary } = redactToolResult(rawResult, {
      enabled: env.REDACTION_ENABLED,
      replacement: env.REDACTION_REPLACEMENT,
    })

    const latencyMs = Date.now() - startedAt
    const status = rawResult.isError === true ? 'error' : 'success'

    if (summary.total > 0) {
      for (const [rule, count] of Object.entries(summary.hits)) {
        redactionsTotal.inc({ rule }, count)
      }
      logger.warn(
        { server: catalogTool.server, tool: catalogTool.name, hits: summary.hits, total: summary.total },
        'Redacted sensitive data from tool response'
      )
    }

    recordToolCall(catalogTool.server, catalogTool.name, status, latencyMs / 1000)

    if (cacheKey !== undefined && status === 'success') {
      setCached(cacheKey, result, env.READ_CACHE_TTL_SECONDS, env.READ_CACHE_MAX_ENTRIES)
    }

    await recordAudit({
      userId: caller.userId,
      serverName: catalogTool.server,
      toolName: catalogTool.name,
      request: params,
      response: result,
      latencyMs,
      status,
    })
    return resultResponse(id, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const latencyMs = Date.now() - startedAt

    recordToolCall(catalogTool.server, catalogTool.name, 'error', latencyMs / 1000)

    await recordAudit({
      userId: caller.userId,
      serverName: catalogTool.server,
      toolName: catalogTool.name,
      request: params,
      response: { error: message },
      latencyMs,
      status: 'error',
    })

    return errorResponse(id, -32603, `Tool execution failed: ${message}`)
  }
}

const withApproval = async (
  request: JsonRpcRequestInput,
  params: ToolCallParams,
  caller: CallerContext
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const catalogTool = findCatalogTool(params.name)
  if (catalogTool === undefined) {
    return errorResponse(id, -32602, `Unknown tool: ${params.name}`)
  }

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
    return callTool(request, params, caller)
  }

  const message =
    decision === 'rejected'
      ? `Tool call rejected by approver: ${params.name}`
      : `Tool call not approved before timeout: ${params.name}`

  return errorResponse(id, -32004, message, { approvalId: approval.id, status: decision })
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

    case 'tools/call': {
      const parsed = callToolParamsSchema.safeParse(request.params)
      if (!parsed.success) {
        return errorResponse(id, -32602, 'Invalid tools/call parameters', parsed.error.flatten())
      }
      if (!isToolAllowed(caller, parsed.data.name)) {
        return errorResponse(id, -32003, `Forbidden tool: ${parsed.data.name}`)
      }
      if (await requiresApproval(parsed.data.name)) {
        return withApproval(request, parsed.data, caller)
      }
      return callTool(request, parsed.data, caller)
    }

    case 'resources/list':
      return resultResponse(id, { resources: listWireResources() })

    case 'resources/templates/list':
      return resultResponse(id, { resourceTemplates: listWireResourceTemplates() })

    case 'resources/read': {
      const parsed = readResourceParamsSchema.safeParse(request.params)
      if (!parsed.success) {
        return errorResponse(id, -32602, 'Invalid resources/read parameters', parsed.error.flatten())
      }
      return readResource(request, parsed.data)
    }

    case 'prompts/list':
      return resultResponse(id, { prompts: listWirePrompts() })

    case 'prompts/get': {
      const parsed = getPromptParamsSchema.safeParse(request.params)
      if (!parsed.success) {
        return errorResponse(id, -32602, 'Invalid prompts/get parameters', parsed.error.flatten())
      }
      return getPrompt(request, parsed.data)
    }

    default:
      return errorResponse(id, -32601, `Method not found: ${request.method}`)
  }
}

const readResource = async (
  request: JsonRpcRequestInput,
  params: ReadResourceParams
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const parsed = parseExposedResourceUri(params.uri)

  if (parsed === undefined || !registry.has(parsed.server)) {
    return errorResponse(id, -32602, `Unknown resource: ${params.uri}`)
  }

  const server = registry.get(parsed.server)
  try {
    const rawResult = await server.client.readResource({ uri: parsed.uri })

    const env = getEnv()
    const { result, summary } = redactToolResult(rawResult, {
      enabled: env.REDACTION_ENABLED,
      replacement: env.REDACTION_REPLACEMENT,
    })

    if (summary.total > 0) {
      for (const [rule, count] of Object.entries(summary.hits)) {
        redactionsTotal.inc({ rule }, count)
      }
      logger.warn(
        { server: server.name, resource: parsed.uri, hits: summary.hits, total: summary.total },
        'Redacted sensitive data from resource contents'
      )
    }

    return resultResponse(id, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(id, -32603, `Resource read failed: ${message}`)
  }
}

const getPrompt = async (
  request: JsonRpcRequestInput,
  params: GetPromptParams
): Promise<JsonRpcResponse> => {
  const id = request.id ?? null
  const catalogPrompt = findCatalogPrompt(params.name)

  if (catalogPrompt === undefined) {
    return errorResponse(id, -32602, `Unknown prompt: ${params.name}`)
  }

  const server = registry.get(catalogPrompt.server)
  try {
    const rawResult = await server.client.getPrompt({
      name: catalogPrompt.originalName,
      arguments: params.arguments,
    })

    const env = getEnv()
    const { result, summary } = redactToolResult(rawResult, {
      enabled: env.REDACTION_ENABLED,
      replacement: env.REDACTION_REPLACEMENT,
    })

    if (summary.total > 0) {
      for (const [rule, count] of Object.entries(summary.hits)) {
        redactionsTotal.inc({ rule }, count)
      }
      logger.warn(
        { server: server.name, prompt: catalogPrompt.originalName, hits: summary.hits, total: summary.total },
        'Redacted sensitive data from prompt response'
      )
    }

    return resultResponse(id, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(id, -32603, `Prompt resolution failed: ${message}`)
  }
}