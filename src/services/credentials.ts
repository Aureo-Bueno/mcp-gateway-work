import { randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { apiKeys, profileTools, profiles, users } from '../db/schema'
import { hashApiKey } from './apiKeys'

export interface GeneratedApiKey {
  key: string
  prefix: string
  hash: string
}

export interface CreatedApiKey {
  id: number
  userId: number
  userName: string
  prefix: string
  key: string
  expiresAt: Date
}

export interface ApiKeySummary {
  id: number
  userId: number
  userName: string
  prefix: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export interface UserSummary {
  id: number
  name: string
  profile: string
  createdAt: Date
}

export interface ProfileSummary {
  id: number
  name: string
  patterns: string[]
  createdAt: Date
}

export const generateApiKey = (): GeneratedApiKey => {
  const secret = randomBytes(32).toString('base64url')
  const key = `mcp_${secret}`
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

export const createApiKey = async (
  userName: string,
  expiresInDays: number
): Promise<CreatedApiKey> => {
  const db = getDb()

  const userRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.name, userName))
    .limit(1)

  const user = userRows[0]
  if (user === undefined) {
    throw new Error(`User "${userName}" does not exist`)
  }

  const generated = generateApiKey()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  const inserted = await db
    .insert(apiKeys)
    .values({ userId: user.id, prefix: generated.prefix, hash: generated.hash, expiresAt })
    .returning({ id: apiKeys.id })

  const row = inserted[0]
  if (row === undefined) {
    throw new Error('Failed to persist API key')
  }

  return { id: row.id, userId: user.id, userName: user.name, prefix: generated.prefix, key: generated.key, expiresAt }
}

export const listApiKeys = async (): Promise<ApiKeySummary[]> => {
  const rows = await getDb()
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      userName: users.name,
      prefix: apiKeys.prefix,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .orderBy(desc(apiKeys.createdAt))

  return rows
}

export const revokeApiKey = async (id: number): Promise<boolean> => {
  const updated = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id })

  return updated.length > 0
}

export const createUser = async (name: string, profileName: string): Promise<UserSummary> => {
  const db = getDb()

  const profileRows = await db
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .where(eq(profiles.name, profileName))
    .limit(1)

  const profile = profileRows[0]
  if (profile === undefined) {
    throw new Error(`Profile "${profileName}" does not exist`)
  }

  const inserted = await db
    .insert(users)
    .values({ name, profileId: profile.id })
    .onConflictDoNothing({ target: users.name })
    .returning({ id: users.id, name: users.name, createdAt: users.createdAt })

  const row = inserted[0]
  if (row !== undefined) {
    return { id: row.id, name: row.name, profile: profile.name, createdAt: row.createdAt }
  }

  const existingRows = await db
    .select({ id: users.id, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.name, name))
    .limit(1)

  const existing = existingRows[0]
  if (existing === undefined) {
    throw new Error(`Failed to create user "${name}"`)
  }

  return { id: existing.id, name: existing.name, profile: profile.name, createdAt: existing.createdAt }
}

export const listUsers = async (): Promise<UserSummary[]> =>
  getDb()
    .select({
      id: users.id,
      name: users.name,
      profile: profiles.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(profiles, eq(users.profileId, profiles.id))
    .orderBy(users.id)

export const createProfile = async (
  name: string,
  patterns: string[]
): Promise<ProfileSummary> => {
  const db = getDb()

  const inserted = await db
    .insert(profiles)
    .values({ name })
    .onConflictDoNothing({ target: profiles.name })
    .returning({ id: profiles.id, name: profiles.name, createdAt: profiles.createdAt })

  let profile = inserted[0]

  if (profile === undefined) {
    const existingRows = await db
      .select({ id: profiles.id, name: profiles.name, createdAt: profiles.createdAt })
      .from(profiles)
      .where(eq(profiles.name, name))
      .limit(1)
    profile = existingRows[0]
  }

  if (profile === undefined) {
    throw new Error(`Failed to create profile "${name}"`)
  }

  await replaceProfileTools(name, patterns)

  return { id: profile.id, name: profile.name, patterns, createdAt: profile.createdAt }
}

export const replaceProfileTools = async (name: string, patterns: string[]): Promise<void> => {
  const db = getDb()

  const profileRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.name, name))
    .limit(1)

  const profile = profileRows[0]
  if (profile === undefined) {
    throw new Error(`Profile "${name}" does not exist`)
  }

  await db.transaction(async (tx) => {
    await tx.delete(profileTools).where(eq(profileTools.profileId, profile.id))
    if (patterns.length > 0) {
      await tx
        .insert(profileTools)
        .values(patterns.map((toolPattern) => ({ profileId: profile.id, toolPattern })))
    }
  })
}

export const listProfiles = async (): Promise<ProfileSummary[]> => {
  const db = getDb()

  const allProfiles = await db
    .select({ id: profiles.id, name: profiles.name, createdAt: profiles.createdAt })
    .from(profiles)
    .orderBy(profiles.id)

  const allTools = await db
    .select({ profileId: profileTools.profileId, toolPattern: profileTools.toolPattern })
    .from(profileTools)

  return allProfiles.map((profile) => ({
    ...profile,
    patterns: allTools
      .filter((tool) => tool.profileId === profile.id)
      .map((tool) => tool.toolPattern),
  }))
}
