import { pino, type Logger } from 'pino'
import { getEnv } from './config/env'

export const logger: Logger = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: 'mcp-gateway' },
})
