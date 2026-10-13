import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { gatewaySettings } from '../db/schema'

export const getSetting = async (key: string): Promise<unknown> => {
  const rows = await getDb().select().from(gatewaySettings).where(eq(gatewaySettings.key, key))
  return rows[0]?.value
}

export const setSetting = async (key: string, value: unknown): Promise<void> => {
  await getDb()
    .insert(gatewaySettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: gatewaySettings.key, set: { value, updatedAt: new Date() } })
}

export const deleteSetting = async (key: string): Promise<void> => {
  await getDb().delete(gatewaySettings).where(eq(gatewaySettings.key, key))
}
