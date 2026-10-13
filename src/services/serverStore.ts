import { asc, eq } from 'drizzle-orm'
import type { ServerConfig } from '../config/servers'
import { getDb } from '../db/client'
import { servers, type ServerRow } from '../db/schema'

export interface PersistedServer {
  name: string
  type: 'stdio' | 'http'
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
  headers: Record<string, string> | null
  createdAt: Date
}

const toPersisted = (row: ServerRow): PersistedServer => ({
  name: row.name,
  type: row.type,
  command: row.command,
  args: row.argsJson,
  env: row.envJson,
  url: row.url,
  headers: row.headersJson,
  createdAt: row.createdAt,
})

export const rowToServerConfig = (row: ServerRow): ServerConfig | null => {
  if (row.type === 'stdio') {
    if (row.command === null || row.command.length === 0) {
      return null
    }
    return {
      name: row.name,
      type: 'stdio',
      command: row.command,
      args: row.argsJson ?? [],
      ...(row.envJson ? { env: row.envJson } : {}),
    }
  }

  if (row.url === null || row.url.length === 0) {
    return null
  }

  return {
    name: row.name,
    type: 'http',
    url: row.url,
    ...(row.headersJson ? { headers: row.headersJson } : {}),
  }
}

export const listServerRecords = async (): Promise<PersistedServer[]> => {
  const rows = await getDb().select().from(servers).orderBy(asc(servers.name))
  return rows.map(toPersisted)
}

export const listServerConfigs = async (): Promise<ServerConfig[]> => {
  const rows = await getDb().select().from(servers).orderBy(asc(servers.name))
  return rows
    .map(rowToServerConfig)
    .filter((config): config is ServerConfig => config !== null)
}

export const getServerConfig = async (name: string): Promise<ServerConfig | null> => {
  const rows = await getDb().select().from(servers).where(eq(servers.name, name))
  const row = rows[0]
  return row === undefined ? null : rowToServerConfig(row)
}

export const countServers = async (): Promise<number> => {
  const rows = await getDb().select({ id: servers.id }).from(servers)
  return rows.length
}

export const saveServer = async (config: ServerConfig): Promise<void> => {
  const values =
    config.type === 'stdio'
      ? {
          name: config.name,
          type: 'stdio' as const,
          command: config.command,
          argsJson: config.args,
          envJson: config.env ?? null,
          url: null,
        }
      : {
          name: config.name,
          type: 'http' as const,
          command: null,
          argsJson: null,
          envJson: null,
          url: config.url,
          headersJson: config.headers ?? null,
        }

  await getDb()
    .insert(servers)
    .values(values)
    .onConflictDoUpdate({ target: servers.name, set: values })
}

export const deleteServerRecord = async (name: string): Promise<boolean> => {
  const deleted = await getDb()
    .delete(servers)
    .where(eq(servers.name, name))
    .returning({ id: servers.id })

  return deleted.length > 0
}
