export interface RedactionRule {
  name: string
  source: string
  flags: string
}

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  { name: 'openai_key', source: '\\bsk-[A-Za-z0-9_-]{16,}\\b', flags: 'g' },
  { name: 'github_token', source: '\\bgh[pousr]_[A-Za-z0-9]{20,}\\b', flags: 'g' },
  { name: 'slack_token', source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b', flags: 'g' },
  { name: 'aws_access_key', source: '\\bAKIA[0-9A-Z]{16}\\b', flags: 'g' },
  { name: 'google_api_key', source: '\\bAIza[0-9A-Za-z_-]{35}\\b', flags: 'g' },
  {
    name: 'jwt',
    source: '\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b',
    flags: 'g',
  },
  { name: 'bearer_token', source: '(?<=Bearer\\s+)[A-Za-z0-9._-]{6,}', flags: 'gi' },
  { name: 'cpf', source: '\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b', flags: 'g' },
  { name: 'credit_card', source: '\\b(?:\\d{4}[- ]?){3}\\d{1,4}\\b', flags: 'g' },
  {
    name: 'secret_assignment',
    source:
      '(?<=(?:api[_-]?key|token|secret|password|passwd)["\']?\\s*[:=]\\s*)["\']?[A-Za-z0-9._-]{8,}',
    flags: 'gi',
  },
]

export type RedactionHits = Record<string, number>

export interface RedactionSummary {
  total: number
  hits: RedactionHits
}

export interface RedactionOptions {
  enabled?: boolean
  replacement?: string
  rules?: RedactionRule[]
}

export const redactString = (
  input: string,
  replacement = '***',
  rules: RedactionRule[] = DEFAULT_REDACTION_RULES
): { text: string; hits: RedactionHits } => {
  let text = input
  const hits: RedactionHits = {}

  for (const rule of rules) {
    const matches = text.match(new RegExp(rule.source, rule.flags))
    if (matches === null || matches.length === 0) {
      continue
    }
    hits[rule.name] = (hits[rule.name] ?? 0) + matches.length
    text = text.replace(new RegExp(rule.source, rule.flags), replacement)
  }

  return { text, hits }
}

const redactValue = (
  value: unknown,
  summary: RedactionSummary,
  replacement: string,
  rules: RedactionRule[]
): unknown => {
  if (typeof value === 'string') {
    const { text, hits } = redactString(value, replacement, rules)
    for (const [rule, count] of Object.entries(hits)) {
      summary.hits[rule] = (summary.hits[rule] ?? 0) + count
      summary.total += count
    }
    return text
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, summary, replacement, rules))
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item, summary, replacement, rules)
    }
    return out
  }

  return value
}

export const redactToolResult = <T>(
  result: T,
  options: RedactionOptions = {}
): { result: T; summary: RedactionSummary } => {
  const summary: RedactionSummary = { total: 0, hits: {} }

  if (options.enabled === false) {
    return { result, summary }
  }

  const replacement = options.replacement ?? '***'
  const rules = options.rules ?? DEFAULT_REDACTION_RULES
  const redacted = redactValue(result, summary, replacement, rules) as T

  return { result: redacted, summary }
}
