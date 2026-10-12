import { eq } from 'drizzle-orm'
import { getEnv } from '../config/env'
import { generateApiKey } from '../services/credentials'
import { closeDb, getDb, initDb } from './client'
import { apiKeys, approvalRules, profileTools, profiles, users } from './schema'

const PROFILE_PATTERNS: Record<string, string[]> = {
  admin: ['*'],
  developer: ['github__*', 'filesystem__*'],
  readonly: ['github__list_*', 'github__get_*'],
}

const DEFAULT_APPROVAL_RULES = [
  '*__delete_*',
  '*__delete',
  '*__remove_*',
  '*__drop_*',
  '*__create_*',
  '*__update_*',
  '*__write_*',
  '*__execute_*',
  '*__send_*',
]

const SEED_USERS: Array<{ name: string; profile: string }> = [
  { name: 'admin', profile: 'admin' },
  { name: 'developer', profile: 'developer' },
  { name: 'readonly', profile: 'readonly' },
]

const EXPIRES_IN_DAYS = 365

const main = async (): Promise<void> => {
  const env = getEnv()
  await initDb(env.DATABASE_URL)
  const db = getDb()

  const expiresAt = new Date(Date.now() + EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000)

  await db
    .insert(approvalRules)
    .values(DEFAULT_APPROVAL_RULES.map((toolPattern) => ({ toolPattern, enabled: true })))
    .onConflictDoNothing({ target: approvalRules.toolPattern })

  for (const [profileName, patterns] of Object.entries(PROFILE_PATTERNS)) {
    const inserted = await db
      .insert(profiles)
      .values({ name: profileName })
      .onConflictDoNothing({ target: profiles.name })
      .returning({ id: profiles.id, name: profiles.name })

    let profile = inserted[0]
    if (profile === undefined) {
      const existing = await db
        .select({ id: profiles.id, name: profiles.name })
        .from(profiles)
        .where(eq(profiles.name, profileName))
        .limit(1)
      profile = existing[0]
    }
    if (profile === undefined) {
      throw new Error(`Failed to create profile "${profileName}"`)
    }

    const existingTools = await db
      .select({ id: profileTools.id })
      .from(profileTools)
      .where(eq(profileTools.profileId, profile.id))

    if (existingTools.length === 0) {
      await db
        .insert(profileTools)
        .values(patterns.map((toolPattern) => ({ profileId: profile.id, toolPattern })))
    }
  }

  const created: Array<{ user: string; key: string }> = []

  for (const seedUser of SEED_USERS) {
    const profileRows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.name, seedUser.profile))
      .limit(1)
    const profile = profileRows[0]
    if (profile === undefined) throw new Error(`Profile "${seedUser.profile}" missing`)

    const insertedUsers = await db
      .insert(users)
      .values({ name: seedUser.name, profileId: profile.id })
      .onConflictDoNothing({ target: users.name })
      .returning({ id: users.id })

    let user = insertedUsers[0]
    if (user === undefined) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.name, seedUser.name))
        .limit(1)
      user = existing[0]
    }
    if (user === undefined) throw new Error(`Failed to create user "${seedUser.name}"`)

    const existingKeys = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .limit(1)

    if (existingKeys.length > 0) {
      continue
    }

    const generated = generateApiKey()
    await db.insert(apiKeys).values({
      userId: user.id,
      prefix: generated.prefix,
      hash: generated.hash,
      expiresAt,
    })
    created.push({ user: seedUser.name, key: generated.key })
  }

  if (created.length > 0) {
    console.log('\nGenerated API keys (store them now, they are not recoverable):')
    for (const entry of created) {
      console.log(`  ${entry.user.padEnd(10)} ${entry.key}`)
    }
    console.log('')
  } else {
    console.log('Seed already applied; no new API keys generated.')
  }

  await closeDb()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
