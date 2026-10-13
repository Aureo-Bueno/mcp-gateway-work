import { isSensitiveKey, redactArguments, redactString, redactToolResult } from '../../src/services/redaction'

describe('redactString', () => {
  it('redacts OpenAI-style keys', () => {
    const { text, hits } = redactString('key sk-abcdef0123456789ABCD here')
    expect(text).toBe('key *** here')
    expect(hits['openai_key']).toBe(1)
  })

  it('redacts GitHub tokens', () => {
    const { text } = redactString('ghp_abcdefghijklmnopqrstuvwx')
    expect(text).toBe('***')
  })

  it('redacts CPF', () => {
    const { text } = redactString('cpf 123.456.789-00 fim')
    expect(text).toBe('cpf *** fim')
  })

  it('redacts credit card numbers', () => {
    const { text } = redactString('card 4111 1111 1111 1111 ok')
    expect(text).toBe('card *** ok')
  })

  it('redacts the bearer token but keeps the scheme', () => {
    const { text } = redactString('Authorization: Bearer abc123XYZ')
    expect(text).toBe('Authorization: Bearer ***')
  })

  it('redacts the value of a secret assignment but keeps the key', () => {
    const { text } = redactString('api_key=supersecretvalue')
    expect(text).toBe('api_key=***')
  })

  it('leaves clean text untouched', () => {
    const { text, hits } = redactString('nothing sensitive here')
    expect(text).toBe('nothing sensitive here')
    expect(hits).toEqual({})
  })

  it('uses a custom replacement', () => {
    expect(redactString('sk-abcdef0123456789ABCD', '[X]').text).toBe('[X]')
  })
})

describe('redactToolResult', () => {
  it('recursively redacts strings in nested structures', () => {
    const input = {
      content: [{ type: 'text', text: 'cpf 123.456.789-00' }],
      structuredContent: { token: 'sk-abcdef0123456789ABCD' },
    }

    const { result, summary } = redactToolResult(input)

    expect(JSON.stringify(result)).not.toContain('123.456.789-00')
    expect(JSON.stringify(result)).not.toContain('sk-abcdef0123456789ABCD')
    expect(result.structuredContent.token).toBe('***')
    expect(summary.total).toBe(2)
  })

  it('keeps non-string values unchanged', () => {
    const { result, summary } = redactToolResult({ count: 3, ok: true, nested: null })
    expect(result).toEqual({ count: 3, ok: true, nested: null })
    expect(summary.total).toBe(0)
  })

  it('is a no-op when disabled', () => {
    const input = { text: 'cpf 123.456.789-00' }
    const { result, summary } = redactToolResult(input, { enabled: false })
    expect(result.text).toBe('cpf 123.456.789-00')
    expect(summary.total).toBe(0)
  })
})

describe('isSensitiveKey', () => {
  it('matches secret-looking key names in any casing or separator style', () => {
    for (const key of ['password', 'db_password', 'githubToken', 'access_token', 'x-api-key', 'apiKey', 'Authorization', 'client_secret', 'private_key', 'Cookie']) {
      expect(isSensitiveKey(key)).toBe(true)
    }
  })

  it('does not match ordinary keys that merely contain a similar word', () => {
    for (const key of ['max_tokens', 'token_type', 'secret_name', 'path', 'text', 'query']) {
      expect(isSensitiveKey(key)).toBe(false)
    }
  })
})

describe('redactArguments', () => {
  it('masks values stored under sensitive keys, even when the value looks harmless', () => {
    const { result, summary } = redactArguments({
      name: 'github__create_issue',
      arguments: { title: 'bug', password: 'hunter2', db: { apiKey: 'abc', port: 5432 }, retries: 3 },
    })

    expect(result.arguments.title).toBe('bug')
    expect(result.arguments.password).toBe('***')
    expect(result.arguments.db.apiKey).toBe('***')
    expect(result.arguments.db.port).toBe(5432)
    expect(result.arguments.retries).toBe(3)
    expect(summary.hits['sensitive_key']).toBe(2)
  })

  it('also applies the value patterns to every string', () => {
    const { result } = redactArguments({ text: 'my key is sk-abcdef0123456789ABCD' })
    expect(result.text).toBe('my key is ***')
  })

  it('is a no-op when disabled', () => {
    const input = { password: 'hunter2' }
    expect(redactArguments(input, { enabled: false }).result).toEqual(input)
  })

  it('does not mutate the original arguments forwarded upstream', () => {
    const input = { password: 'hunter2' }
    redactArguments(input)
    expect(input.password).toBe('hunter2')
  })
})

describe('redactToolResult and sensitive keys', () => {
  it('does not mask response fields by key name, so pagination tokens keep working', () => {
    const { result } = redactToolResult({ structuredContent: { nextPageToken: 'cursor-42' } })
    expect(result.structuredContent.nextPageToken).toBe('cursor-42')
  })
})
