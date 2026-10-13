import { getEnv } from '../../src/config/env'
import { closeDb, initDb } from '../../src/db/client'
import { SERVERS_SEEDED_KEY, seedServersFromConfigOnce } from '../../src/services/serverBootstrap'
import { deleteSetting, getSetting, setSetting } from '../../src/services/settings'

let previous: unknown

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  previous = await getSetting(SERVERS_SEEDED_KEY)
})

afterAll(async () => {
  // Leave the database as the gateway expects it: bootstrap already done.
  await setSetting(SERVERS_SEEDED_KEY, previous ?? { at: new Date().toISOString(), seeded: 0 })
  await closeDb()
})

describe('seedServersFromConfigOnce', () => {
  it('records that the bootstrap ran, then never reads the config file again', async () => {
    await setSetting(SERVERS_SEEDED_KEY, { at: new Date().toISOString(), seeded: 0 })
    const loadConfig = jest.fn(() => [])

    const result = await seedServersFromConfigOnce(loadConfig)

    expect(result.skipped).toBe(true)
    expect(loadConfig).not.toHaveBeenCalled()
  })

  it('marks the bootstrap as done on the first run', async () => {
    await deleteSetting(SERVERS_SEEDED_KEY)

    const result = await seedServersFromConfigOnce(() => [])

    expect(result.skipped).toBe(false)
    expect(await getSetting(SERVERS_SEEDED_KEY)).toBeDefined()

    const loadAgain = jest.fn(() => [])
    expect((await seedServersFromConfigOnce(loadAgain)).skipped).toBe(true)
    expect(loadAgain).not.toHaveBeenCalled()
  })
})
