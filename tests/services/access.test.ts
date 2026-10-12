import { matchesPattern, isToolAllowed } from '../../src/services/access'
import type { CallerContext } from '../../src/types/index'

const caller = (allowedPatterns: string[]): CallerContext => ({
  userId: 1,
  userName: 'test',
  profile: 'test',
  keyPrefix: 'mcp_test',
  allowedPatterns,
})

describe('matchesPattern', () => {
  it('matches the wildcard pattern', () => {
    expect(matchesPattern('echo__echo', '*')).toBe(true)
  })

  it('matches prefix wildcards', () => {
    expect(matchesPattern('github__create_issue', 'github__*')).toBe(true)
    expect(matchesPattern('echo__echo', 'github__*')).toBe(false)
  })

  it('matches suffix wildcards', () => {
    expect(matchesPattern('github__list_repos', 'github__list_*')).toBe(true)
    expect(matchesPattern('github__delete_repo', 'github__list_*')).toBe(false)
  })

  it('treats regex metacharacters literally', () => {
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
    expect(matchesPattern('axb', 'a.b')).toBe(false)
  })
})

describe('isToolAllowed', () => {
  it('allows when any pattern matches', () => {
    expect(isToolAllowed(caller(['echo__*', 'filesystem__read']), 'echo__add')).toBe(true)
  })

  it('denies when no pattern matches', () => {
    expect(isToolAllowed(caller(['github__*']), 'echo__add')).toBe(false)
  })

  it('denies when there are no patterns', () => {
    expect(isToolAllowed(caller([]), 'echo__add')).toBe(false)
  })
})
