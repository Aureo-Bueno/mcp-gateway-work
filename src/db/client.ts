import { resolve } from 'node:path'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import * as schema from './schema'

let pool: Pool | null = null
let database: NodePgDatabase<typeof schema> | null = null

export type Db = NodePgDatabase<typeof schema>

export const initDb = async (databaseUrl: string): Promise<Db> => {
  pool = new Pool({ connectionString: databaseUrl })
  const instance = drizzle(pool, { schema })

  await migrate(instance, { migrationsFolder: resolve('migrations') })

  database = instance
  return instance
}

export const getDb = (): Db => {
  if (database === null) {
    throw new Error('Database not initialized')
  }
  return database
}

export const closeDb = async (): Promise<void> => {
  if (pool !== null) {
    await pool.end()
    pool = null
    database = null
  }
}
