const READ_TOOL_PATTERN =
  /^(get|list|read|search|fetch|find|query|describe|show|lookup|stat|info|status|head)(?:[_\s/.]|$)/i

interface CachedEntry {
  value: unknown
  expiresAt: number
}

const store = new Map<string, CachedEntry>()

export const isReadOnlyTool = (originalName: string): boolean =>
  READ_TOOL_PATTERN.test(originalName)

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== '__proto__')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

export const makeCacheKey = (server: string, originalName: string, args: unknown): string =>
  `${server}:${originalName}:${stableStringify(args ?? {})}`

export const getCached = (key: string): { hit: boolean; value?: unknown } => {
  const entry = store.get(key)
  if (entry === undefined) {
    return { hit: false }
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return { hit: false }
  }
  return { hit: true, value: entry.value }
}

export const setCached = (
  key: string,
  value: unknown,
  ttlSeconds: number,
  maxEntries: number
): void => {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value
    if (oldest === undefined) {
      break
    }
    store.delete(oldest)
  }
}

export const clearReadCache = (serverName?: string): void => {
  if (serverName === undefined) {
    store.clear()
    return
  }
  for (const key of store.keys()) {
    if (key.startsWith(`${serverName}:`)) {
      store.delete(key)
    }
  }
}

export const readCacheSize = (): number => store.size