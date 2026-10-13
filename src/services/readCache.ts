/** Verbs that, as the first word of a tool name, suggest a read-only tool. */
const READ_VERBS = new Set([
  'get',
  'list',
  'read',
  'search',
  'fetch',
  'find',
  'describe',
  'show',
  'lookup',
  'stat',
  'info',
  'status',
  'head',
])

/**
 * Words that signal a side effect anywhere in the name. A single match makes the
 * tool non-cacheable, so `get_or_create_user`, `find_and_replace` or
 * `read_and_delete` are never served from cache. When in doubt the tool is not
 * cached: a missed cache hit costs one upstream call, a wrong one skips a write.
 */
const WRITE_WORDS = new Set([
  'create', 'insert', 'add', 'append', 'update', 'upsert', 'patch', 'put', 'set', 'edit',
  'modify', 'replace', 'rename', 'move', 'copy', 'delete', 'del', 'remove', 'drop',
  'truncate', 'purge', 'clear', 'reset', 'destroy', 'erase', 'write', 'save', 'upload',
  'import', 'export', 'send', 'publish', 'push', 'notify', 'notification', 'execute',
  'exec', 'run', 'invoke', 'call', 'trigger', 'start', 'stop', 'restart', 'kill',
  'terminate', 'cancel', 'deploy', 'apply', 'commit', 'merge', 'rebase', 'revert',
  'approve', 'reject', 'assign', 'unassign', 'close', 'lock', 'unlock', 'archive',
  'unarchive', 'enable', 'disable', 'toggle', 'increment', 'decrement', 'sync',
  'refresh', 'mark', 'fork', 'mutate', 'sql', 'query',
])

/** Splits `get_user`, `get-user`, `getUser`, `get.user` or `get user` into words. */
const tokenize = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())

interface CachedEntry {
  value: unknown
  expiresAt: number
}

const store = new Map<string, CachedEntry>()

/**
 * A tool is cacheable when its first word is a read verb and no word in its name
 * signals a side effect. Works with snake_case, kebab-case and camelCase names.
 */
export const isReadOnlyTool = (originalName: string): boolean => {
  const words = tokenize(originalName)
  const first = words[0]
  if (first === undefined || !READ_VERBS.has(first)) {
    return false
  }
  return !words.some((word) => WRITE_WORDS.has(word))
}

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