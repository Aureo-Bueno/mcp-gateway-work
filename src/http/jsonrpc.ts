import { z } from 'zod'
import type { JsonRpcId, JsonRpcResponse } from '../types/index'

export const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()])

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
})

export type JsonRpcRequestInput = z.infer<typeof jsonRpcRequestSchema>

export const callToolParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
})

export const readResourceParamsSchema = z.object({
  uri: z.string().min(1),
})

export const getPromptParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()).optional(),
})

export const resultResponse = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const errorResponse = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})