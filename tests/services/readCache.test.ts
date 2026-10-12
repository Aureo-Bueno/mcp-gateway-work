import {
  clearReadCache,
  getCached,
  isReadOnlyTool,
  makeCacheKey,
  readCacheSize,
  setCached,
} from '../../src/services/readCache'

describe('readCache', () => {
  beforeEach(() => {
    clearReadCache()
  })

  it('detects read-only tool names via the prefix heuristic', () => {
    expect(isReadOnlyTool('get_counter')).toBe(true)
    expect(isReadOnlyTool('list_users')).toBe(true)
    expect(isReadOnlyTool('read_wiki_structure')).toBe(true)
    expect(isReadOnlyTool('search')).toBe(true)
    expect(isReadOnlyTool('add')).toBe(false)
    expect(isReadOnlyTool('echo')).toBe(false)
    expect(isReadOnlyTool('ask_question')).toBe(false)
  })

  it('builds order-independent cache keys', () => {
    const a = makeCacheKey('echo', 'get', { a: 1, b: 2 })
    const b = makeCacheKey('echo', 'get', { b: 2, a: 1 })
    expect(a).toBe(b)
    expect(makeCacheKey('echo', 'get', { a: 1 })).not.toBe(a)
  })

  it('stores and retrieves entries', () => {
    const key = makeCacheKey('echo', 'get', {})
    expect(getCached(key).hit).toBe(false)
    setCached(key, { value: 1 }, 30, 100)
    const cached = getCached(key)
    expect(cached.hit).toBe(true)
    expect(cached.value).toEqual({ value: 1 })
  })

  it('expires entries past their ttl', () => {
    const key = makeCacheKey('echo', 'get', {})
    setCached(key, 'v', -1, 100)
    expect(getCached(key).hit).toBe(false)
  })

  it('evicts the oldest entries beyond maxEntries', () => {
    setCached('k1', 1, 30, 2)
    setCached('k2', 2, 30, 2)
    setCached('k3', 3, 30, 2)
    expect(readCacheSize()).toBe(2)
    expect(getCached('k1').hit).toBe(false)
    expect(getCached('k3').hit).toBe(true)
  })

  it('clears entries for a single server', () => {
    setCached(makeCacheKey('echo', 'get', {}), 1, 30, 100)
    setCached(makeCacheKey('other', 'get', {}), 2, 30, 100)
    clearReadCache('echo')
    expect(readCacheSize()).toBe(1)
    expect(getCached(makeCacheKey('echo', 'get', {})).hit).toBe(false)
    expect(getCached(makeCacheKey('other', 'get', {})).hit).toBe(true)
  })
})