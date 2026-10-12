import { getEnv } from '../config/env'
import { closeDb, initDb } from './client'

const main = async (): Promise<void> => {
  const env = getEnv()
  await initDb(env.DATABASE_URL)
  console.log('Database migrations applied successfully')
  await closeDb()
}

main().catch((error: unknown) => {
  console.error('Migration failed', error)
  process.exit(1)
})
