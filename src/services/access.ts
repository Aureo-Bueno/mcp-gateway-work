import type { CallerContext } from '../types/index'

const escapeRegex = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

export const matchesPattern = (toolName: string, pattern: string): boolean => {
  if (pattern === '*') {
    return true
  }
  const regex = new RegExp(`^${escapeRegex(pattern).replace(/\*/g, '.*')}$`)
  return regex.test(toolName)
}

export const isToolAllowed = (caller: CallerContext, toolName: string): boolean =>
  caller.allowedPatterns.some((pattern) => matchesPattern(toolName, pattern))