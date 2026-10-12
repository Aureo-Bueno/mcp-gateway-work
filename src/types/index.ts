import type {
  CallToolResult,
  Implementation,
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from '@modelcontextprotocol/sdk/types'

export type JsonRpcId = string | number | null

export interface JsonRpcRequestInput {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: JsonRpcErrorShape }

export interface InitializeResultPayload {
  protocolVersion: string
  capabilities: {
    tools: Record<string, never>
    resources: Record<string, never>
    prompts: Record<string, never>
  }
  serverInfo: Implementation
}

export interface CatalogTool {
  name: string
  description?: string
  inputSchema: Tool['inputSchema']
  server: string
  originalName: string
}

export interface WireTool {
  name: string
  description?: string
  inputSchema: Tool['inputSchema']
}

export interface CatalogPrompt {
  name: string
  server: string
  originalName: string
  description?: string
  arguments?: Prompt['arguments']
}

export interface CallerContext {
  userId: number
  userName: string
  profile: string
  keyPrefix: string
  allowedPatterns: string[]
}

export interface ToolCallParams {
  name: string
  arguments: Record<string, unknown>
}

export interface ReadResourceParams {
  uri: string
}

export interface GetPromptParams {
  name: string
  arguments?: Record<string, string>
}

export interface AuditEntry {
  userId: number | null
  serverName: string
  toolName: string
  request: unknown
  response: unknown
  latencyMs: number
  status: 'success' | 'error'
}

export type { CallToolResult, Tool, Resource, ResourceTemplate, Prompt }