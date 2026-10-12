import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys, profileTools, profiles, users } from '../db/schema'
import type { CallerContext } from '../types/index'

export const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex')

export const authenticateApiKey = async (key: string): Promise<CallerContext | null> => {
  const db = getDb()
  const hash = hashApiKey(key)

  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      profileId: profiles.id,
      profileName: profiles.name,
      keyPrefix: apiKeys.prefix,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .innerJoin(profiles, eq(users.profileId, profiles.id))
    .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
    .limit(1)

  const row = rows[0]
  if (row === undefined || row.expiresAt.getTime() <= Date.now()) {
    return null
  }

  const patterns = await db
    .select({ toolPattern: profileTools.toolPattern })
    .from(profileTools)
    .where(eq(profileTools.profileId, row.profileId))

  return {
    userId: row.userId,
    userName: row.userName,
    profile: row.profileName,
    keyPrefix: row.keyPrefix,
    allowedPatterns: patterns.map((pattern) => pattern.toolPattern),
  }
}
