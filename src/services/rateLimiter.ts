import { Redis } from 'ioredis'
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import { getEnv } from '../config/env'
import { logger } from '../logger'

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  msBeforeNext: number
  /** True when no limiter backend could answer; the request is denied. */
  unavailable?: boolean
}

export interface RateLimiterOptions {
  redisUrl?: string
  points?: number
  duration?: number
}

export class RateLimiter {
  private readonly redis: Redis
  private readonly limiter: RateLimiterRedis

  constructor(options: RateLimiterOptions = {}) {
    const env = getEnv()
    const points = options.points ?? env.RATE_LIMIT_POINTS
    const duration = options.duration ?? env.RATE_LIMIT_DURATION

    this.redis = new Redis(options.redisUrl ?? env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    this.redis.on('error', (error: Error) => {
      logger.error({ err: error }, 'Redis connection error')
    })

    this.limiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'mcp-gateway:ratelimit',
      points,
      duration,
      // If Redis is unreachable, keep limiting with a per-process in-memory
      // limiter instead of letting every request through.
      insuranceLimiter: new RateLimiterMemory({
        keyPrefix: 'mcp-gateway:ratelimit:insurance',
        points,
        duration,
      }),
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

      logger.error({ err: error }, 'Rate limiter unavailable; denying request')
      return { allowed: false, remaining: 0, msBeforeNext: 1000, unavailable: true }
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {
      this.redis.disconnect()
    })
  }
}
