import { existsSync } from 'node:fs'
import { z } from 'zod'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://mcp:mcp@localhost:5432/mcp_gateway'),
  GATEWAY_CONFIG: z.string().min(1).default('gateway.config.json'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_DURATION: z.coerce.number().int().positive().default(60),
  APPROVAL_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  CORS_ORIGIN: z.string().min(1).default('*'),
  REDACTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  REDACTION_REPLACEMENT: z.string().min(1).default('***'),
  HEALTH_CHECK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  READ_CACHE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  READ_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  READ_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export const validateEnv = (): Env => {
  if (cached) return cached

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const details = JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
    throw new Error(`Invalid environment variables:\n${details}`)
  }

  cached = parsed.data
  return cached
}

export const getEnv = (): Env => {
  if (!cached) return validateEnv()
  return cached
}