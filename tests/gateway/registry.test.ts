import path from 'node:path'
import { ServerRegistry } from '../../src/gateway/registry'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')

describe('ServerRegistry', () => {
  it('registers an upstream server, lists tools and pings it', async () => {
    const registry = new ServerRegistry()

    const server = await registry.register({
      name: 'echo',
      type: 'stdio',
      command: 'npx',
      args: ['tsx', fixture],
    })

    expect(server.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['echo', 'add'])
    )
    expect(registry.has('echo')).toBe(true)

    await expect(registry.ping('echo')).resolves.toBeUndefined()

    const refreshed = await registry.refreshTools('echo')
    expect(refreshed.map((tool) => tool.name)).toEqual(expect.arrayContaining(['echo', 'add']))

    expect(await registry.unregister('echo')).toBe(true)
    expect(registry.has('echo')).toBe(false)
  }, 30000)

  it('rejects pinging an unknown server', async () => {
    const registry = new ServerRegistry()
    await expect(registry.ping('missing')).rejects.toThrow('not registered')
  })
})
