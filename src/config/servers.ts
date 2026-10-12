import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

export const httpServerSchema = z.object({
  name: z.string().min(1),
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
})

export const stdioServerSchema = z.object({
  name: z.string().min(1),
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export const serverConfigSchema = z.discriminatedUnion('type', [stdioServerSchema, httpServerSchema])

export type StdioServerConfig = z.infer<typeof stdioServerSchema>
export type HttpServerConfig = z.infer<typeof httpServerSchema>
export type ServerConfig = z.infer<typeof serverConfigSchema>

export const gatewayConfigSchema = z.object({
  servers: z.array(serverConfigSchema).default([]),
})

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>

export const loadGatewayConfig = (path: string): GatewayConfig => {
  if (!existsSync(path)) {
    return { servers: [] }
  }

  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  const result = gatewayConfigSchema.safeParse(parsed)

  if (!result.success) {
    throw new Error(`Invalid gateway config "${path}": ${JSON.stringify(result.error.flatten())}`)
  }

  return result.data
}