import {
  callToolParamsSchema,
  errorResponse,
  jsonRpcRequestSchema,
  resultResponse,
} from '../../src/http/jsonrpc'

describe('jsonRpcRequestSchema', () => {
  it('accepts a valid request', () => {
    const parsed = jsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a missing jsonrpc version', () => {
    const parsed = jsonRpcRequestSchema.safeParse({ id: 1, method: 'tools/list' })
    expect(parsed.success).toBe(false)
  })

  it('rejects a non-object params', () => {
    const parsed = jsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: 'nope',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('callToolParamsSchema', () => {
  it('defaults arguments to an empty object', () => {
    const parsed = callToolParamsSchema.parse({ name: 'echo__echo' })
    expect(parsed.arguments).toEqual({})
  })

  it('rejects an empty tool name', () => {
    expect(callToolParamsSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('response helpers', () => {
  it('builds a result response', () => {
    expect(resultResponse(1, { ok: true })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    })
  })

  it('builds an error response without data', () => {
    expect(errorResponse(null, -32601, 'Method not found')).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32601, message: 'Method not found' },
    })
  })
})
