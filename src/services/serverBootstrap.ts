import type { ServerConfig } from '../config/servers'
import { countServers, saveServer } from './serverStore'
import { getSetting, setSetting } from './settings'

export const SERVERS_SEEDED_KEY = 'servers_seeded_from_config'

export interface SeedResult {
  /** True when the bootstrap already ran on an earlier start and nothing was done. */
  skipped: boolean
  seeded: number
}

/**
 * Copies the servers from the config file into the database once, on the very
 * first start (empty `servers` table and no previous bootstrap). After that the
 * database is the only source of truth: removing every server through the admin
 * API does not bring the config file servers back on the next restart.
 */
export const seedServersFromConfigOnce = async (loadConfig: () => ServerConfig[]): Promise<SeedResult> => {
  if ((await getSetting(SERVERS_SEEDED_KEY)) !== undefined) {
    return { skipped: true, seeded: 0 }
  }

  let seeded = 0
  if ((await countServers()) === 0) {
    for (const config of loadConfig()) {
      await saveServer(config)
      seeded += 1
    }
  }

  await setSetting(SERVERS_SEEDED_KEY, { at: new Date().toISOString(), seeded })
  return { skipped: false, seeded }
}
