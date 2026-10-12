import { getHealth, listHealth, recordHealth, removeHealth } from '../../src/services/health'

describe('health store', () => {
  afterEach(() => {
    removeHealth('alpha')
    removeHealth('beta')
  })

  it('records and reads a single entry', () => {
    recordHealth({ name: 'alpha', healthy: true, latencyMs: 12, checkedAt: 'now' })
    expect(getHealth('alpha')).toEqual({
      name: 'alpha',
      healthy: true,
      latencyMs: 12,
      checkedAt: 'now',
    })
    expect(getHealth('missing')).toBeUndefined()
  })

  it('lists and removes entries', () => {
    recordHealth({ name: 'alpha', healthy: true, latencyMs: 1, checkedAt: 'now' })
    recordHealth({ name: 'beta', healthy: false, latencyMs: 5, checkedAt: 'now', error: 'boom' })
    expect(listHealth().map((entry) => entry.name).sort()).toEqual(['alpha', 'beta'])

    removeHealth('alpha')
    expect(listHealth().map((entry) => entry.name)).toEqual(['beta'])
  })
})