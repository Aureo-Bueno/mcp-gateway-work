import { callToolParamsSchema, getPromptParamsSchema, readResourceParamsSchema } from '../http/jsonrpc'
import type { AuditMethod } from '../types/index'
import { findCatalogPrompt, findCatalogTool, parseExposedResourceUri } from './catalog'
import { TOOL_SEPARATOR } from './constants'

export interface AuditTarget {
  method: AuditMethod
  serverName: string
  /** Prefixed tool name, prefixed prompt name or exposed resource URI. */
  toolName: string
  request: unknown
}

const UNKNOWN_SERVER = 'unknown'

/** Best-effort server name for a prefixed name that may not be in the catalog. */
const serverFromPrefixedName = (name: string): string => {
  const separator = name.indexOf(TOOL_SEPARATOR)
  return separator > 0 ? name.slice(0, separator) : UNKNOWN_SERVER
}

/**
 * Describes the target of an auditable JSON-RPC request (`tools/call`,
 * `resources/read`, `prompts/get`). Returns `undefined` for any other method or
 * when the params are malformed.
 */
export const resolveAuditTarget = (method: unknown, params: unknown): AuditTarget | undefined => {
  if (method === 'tools/call') {
    const parsed = callToolParamsSchema.safeParse(params)
    if (!parsed.success) return undefined
    const tool = findCatalogTool(parsed.data.name)
    return {
      method,
      serverName: tool?.server ?? serverFromPrefixedName(parsed.data.name),
      toolName: parsed.data.name,
      request: parsed.data,
    }
  }

  if (method === 'resources/read') {
    const parsed = readResourceParamsSchema.safeParse(params)
    if (!parsed.success) return undefined
    return {
      method,
      serverName: parseExposedResourceUri(parsed.data.uri)?.server ?? UNKNOWN_SERVER,
      toolName: parsed.data.uri,
      request: parsed.data,
    }
  }

  if (method === 'prompts/get') {
    const parsed = getPromptParamsSchema.safeParse(params)
    if (!parsed.success) return undefined
    const prompt = findCatalogPrompt(parsed.data.name)
    return {
      method,
      serverName: prompt?.server ?? serverFromPrefixedName(parsed.data.name),
      toolName: parsed.data.name,
      request: parsed.data,
    }
  }

  return undefined
}
