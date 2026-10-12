import { redactString, redactToolResult } from '../../src/services/redaction'

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
