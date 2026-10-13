import '../helpers/shortApprovalTimeout'
import path from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { getEnv } from '../../src/config/env'
import { closeDb, getDb, initDb } from '../../src/db/client'
import { approvalRules, approvals, auditLogs } from '../../src/db/schema'
import { registry } from '../../src/gateway/registry'
import { handleMcpRequest } from '../../src/gateway/router'
import { createApprovalRule, decideApproval } from '../../src/services/approvals'
import type { CallerContext, JsonRpcResponse } from '../../src/types/index'

const fixture = path.resolve(__dirname, '../fixtures/echo-server.ts')
// A server name unique to this file, so approval rules and audit rows created
// here never affect suites running in parallel against the same database.
const SERVER = `rt${Date.now()}`

const admin: CallerContext = {
  userId: 1,
  userName: 'admin',
  profile: 'admin',
  keyPrefix: 'test',
  allowedPatterns: ['*'],
}

const readonly: CallerContext = { ...admin, profile: 'readonly', allowedPatterns: [`${SERVER}__get_*`] }

const rpc = (caller: CallerContext, method: string, params: Record<string, unknown>, id = 1): Promise<JsonRpcResponse> =>
  handleMcpRequest({ jsonrpc: '2.0', id, method, params }, caller)

const errorOf = (response: JsonRpcResponse): { code: number; message: string; data?: unknown } => {
  if (!('error' in response)) {
    throw new Error(`expected a JSON-RPC error, got ${JSON.stringify(response)}`)
  }
  return response.error
}

const lastAudit = async (toolName: string) => {
  const rows = await getDb()
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.toolName, toolName))
    .orderBy(desc(auditLogs.id))
    .limit(1)
  return rows[0]
}

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
  await registry.register({ name: SERVER, type: 'stdio', command: 'npx', args: ['tsx', fixture] })
}, 30000)

afterAll(async () => {
  const db = getDb()
  await db.delete(approvalRules).where(eq(approvalRules.toolPattern, `${SERVER}__add`))
  await db.delete(approvals).where(eq(approvals.serverName, SERVER))
  await db.delete(auditLogs).where(eq(auditLogs.serverName, SERVER))
  await registry.unregister(SERVER)
  await closeDb()
})

describe('RBAC on tools/call', () => {
  it('returns JSON-RPC -32003 for a tool outside the caller profile and audits it', async () => {
    const tool = `${SERVER}__echo`
    const response = await rpc(readonly, 'tools/call', { name: tool, arguments: { text: 'hi', password: 'hunter2' } })

    expect(errorOf(response).code).toBe(-32003)

    const row = await lastAudit(tool)
    expect(row?.status).toBe('forbidden')
    expect(row?.serverName).toBe(SERVER)
    expect(JSON.stringify(row?.requestJson)).not.toContain('hunter2')
  })

  it('returns -32003 even for tools that do not exist, without revealing it', async () => {
    const response = await rpc(readonly, 'tools/call', { name: `${SERVER}__nope`, arguments: {} })
    expect(errorOf(response).code).toBe(-32003)
  })

  it('returns -32602 for invalid params', async () => {
    const response = await rpc(admin, 'tools/call', { arguments: {} })
    expect(errorOf(response).code).toBe(-32602)
  })

  it('audits unknown tools for allowed callers', async () => {
    const tool = `${SERVER}__does_not_exist`
    const response = await rpc(admin, 'tools/call', { name: tool, arguments: {} })

    expect(errorOf(response).code).toBe(-32602)
    expect((await lastAudit(tool))?.status).toBe('unknown_tool')
  })
})

describe('audit of successful calls', () => {
  it('stores the request arguments with secrets masked', async () => {
    const tool = `${SERVER}__echo`
    const response = await rpc(admin, 'tools/call', { name: tool, arguments: { text: 'key sk-abcdef0123456789ABCD' } })

    expect('result' in response).toBe(true)

    const row = await lastAudit(tool)
    expect(row?.status).toBe('success')
    expect(row?.method).toBe('tools/call')
    expect(JSON.stringify(row?.requestJson)).not.toContain('sk-abcdef0123456789ABCD')
  })

  it('audits resources/read and prompts/get', async () => {
    const uri = `mcp-gateway://${SERVER}/echo://greeting`
    await rpc(admin, 'resources/read', { uri })
    const resourceRow = await lastAudit(uri)
    expect(resourceRow?.method).toBe('resources/read')
    expect(resourceRow?.status).toBe('success')

    const prompt = `${SERVER}__greet`
    await rpc(admin, 'prompts/get', { name: prompt, arguments: { name: 'Aureo' } })
    const promptRow = await lastAudit(prompt)
    expect(promptRow?.method).toBe('prompts/get')
    expect(promptRow?.status).toBe('success')
  })

  it('audits reads of unknown resources', async () => {
    const uri = `mcp-gateway://${SERVER}/echo://missing-${Date.now()}`
    await rpc(admin, 'resources/read', { uri })
    expect((await lastAudit(uri))?.method).toBe('resources/read')
  })
})

describe('human approval outcomes', () => {
  const tool = `${SERVER}__add`

  beforeAll(async () => {
    await createApprovalRule(tool)
  })

  const waitForPendingApproval = async (): Promise<number> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await getDb()
        .select()
        .from(approvals)
        .where(and(eq(approvals.toolName, tool), eq(approvals.status, 'pending')))
      if (rows[0] !== undefined) {
        return rows[0].id
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('approval was never created')
  }

  it('audits a rejected call and stores masked arguments on the approval', async () => {
    const call = rpc(admin, 'tools/call', { name: tool, arguments: { a: 1, b: 2, token: 'tok-secret-value' } })
    const approvalId = await waitForPendingApproval()

    const stored = await getDb().select().from(approvals).where(eq(approvals.id, approvalId))
    expect(JSON.stringify(stored[0]?.argumentsJson)).not.toContain('tok-secret-value')

    await decideApproval(approvalId, 'rejected', 'admin')
    const response = await call

    expect(errorOf(response).code).toBe(-32004)
    expect((await lastAudit(tool))?.status).toBe('rejected')
  })

  it('runs the tool with the original (unmasked) arguments once approved', async () => {
    const call = rpc(admin, 'tools/call', { name: tool, arguments: { a: 2, b: 3 } })
    const approvalId = await waitForPendingApproval()
    await decideApproval(approvalId, 'approved', 'admin')

    const response = await call
    expect(JSON.stringify(response)).toContain('5')
    expect((await lastAudit(tool))?.status).toBe('success')
  })

  it('audits an expired call', async () => {
    const response = await rpc(admin, 'tools/call', { name: tool, arguments: { a: 1, b: 1 } })

    expect(errorOf(response).code).toBe(-32004)
    expect((errorOf(response).data as { status: string }).status).toBe('expired')
    expect((await lastAudit(tool))?.status).toBe('expired')
  }, 10000)
})
