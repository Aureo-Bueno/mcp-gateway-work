import { Redis } from 'ioredis'
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import { getEnv } from '../config/env'
import { logger } from '../logger'

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  msBeforeNext: number
}

export class RateLimiter {
  private readonly redis: Redis
  private readonly limiter: RateLimiterRedis

  constructor() {
    const env = getEnv()
    this.redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    this.redis.on('error', (error: Error) => {
      logger.error({ err: error }, 'Redis connection error')
    })

    this.limiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'mcp-gateway:ratelimit',
      points: env.RATE_LIMIT_POINTS,
      duration: env.RATE_LIMIT_DURATION,
    })
  }

  async consume(key: string, points = 1): Promise<RateLimitDecision> {
    try {
      const result = await this.limiter.consume(key, points)
      return {
        allowed: true,
        remaining: result.remainingPoints,
        msBeforeNext: result.msBeforeNext,
      }
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        return {
          allowed: false,
          remaining: error.remainingPoints,
          msBeforeNext: error.msBeforeNext,
        }
      }

      logger.error({ err: error }, 'Rate limiter backend unavailable; failing open')
      return { allowed: true, remaining: 0, msBeforeNext: 0 }
    }
  }

  async close(): Promise<void> {
    await this.redis.quit()
  }
}