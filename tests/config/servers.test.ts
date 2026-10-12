import { serverConfigSchema } from '../../src/config/servers'

describe('serverConfigSchema', () => {
  it('accepts a stdio server with env', () => {
    const parsed = serverConfigSchema.safeParse({
      name: 'filesystem',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { TOKEN: 'abc' },
    })
    expect(parsed.success).toBe(true)
  })

  it('defaults stdio args to an empty array', () => {
    const parsed = serverConfigSchema.parse({ name: 'e', type: 'stdio', command: 'node' })
    expect(parsed.type).toBe('stdio')
    if (parsed.type === 'stdio') {
      expect(parsed.args).toEqual([])
    }
  })

  it('accepts an http server with headers', () => {
    const parsed = serverConfigSchema.safeParse({
      name: 'remote',
      type: 'http',
      url: 'http://host:8080/mcp',
      headers: { Authorization: 'Bearer token' },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an http server without a valid url', () => {
    expect(serverConfigSchema.safeParse({ name: 'remote', type: 'http' }).success).toBe(false)
    expect(serverConfigSchema.safeParse({ name: 'remote', type: 'http', url: 'not-a-url' }).success).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(serverConfigSchema.safeParse({ name: 'x', type: 'grpc', url: 'http://x' }).success).toBe(false)
  })
})
