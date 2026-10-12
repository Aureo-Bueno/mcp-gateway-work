import { eq } from 'drizzle-orm'
import { getEnv } from '../../src/config/env'
import { closeDb, getDb, initDb } from '../../src/db/client'
import { approvalRules, approvals } from '../../src/db/schema'
import {
  createApproval,
  createApprovalRule,
  decideApproval,
  deleteApprovalRule,
  listApprovals,
  listApprovalRules,
  requiresApproval,
  waitForDecision,
} from '../../src/services/approvals'

const stamp = Date.now()
const PATTERN = `*__jesttest_${stamp}_*`
const TOOL = `echo__jesttest_${stamp}_delete`
const USER = `jest-user-${stamp}`

beforeAll(async () => {
  await initDb(getEnv().DATABASE_URL)
})

afterAll(async () => {
  const db = getDb()
  await db.delete(approvalRules).where(eq(approvalRules.toolPattern, PATTERN))
  await db.delete(approvals).where(eq(approvals.userName, USER))
  await closeDb()
})

describe('approval rules', () => {
  it('requires approval only for matching tools', async () => {
    const rule = await createApprovalRule(PATTERN)
    expect(rule.toolPattern).toBe(PATTERN)
    expect(rule.enabled).toBe(true)

    expect(await requiresApproval(TOOL)).toBe(true)
    expect(await requiresApproval(`echo__other_${stamp}`)).toBe(false)
  })

  it('lists, disables and deletes rules', async () => {
    const disabled = await createApprovalRule(PATTERN, false)
    expect(disabled.enabled).toBe(false)
    expect(await requiresApproval(TOOL)).toBe(false)

    const listed = await listApprovalRules()
    expect(listed.some((r) => r.toolPattern === PATTERN)).toBe(true)

    expect(await deleteApprovalRule(disabled.id)).toBe(true)
    expect(await requiresApproval(TOOL)).toBe(false)
    expect(await deleteApprovalRule(disabled.id)).toBe(false)
  })
})

describe('approval decisions', () => {
  it('resolves a pending call when approved', async () => {
    const approval = await createApproval({
      userId: 1,
      userName: USER,
      serverName: 'echo',
      toolName: TOOL,
      args: { text: 'hi' },
      ttlMs: 5000,
    })
    expect(approval.status).toBe('pending')

    const decision = waitForDecision(approval.id, 5000)
    const decided = await decideApproval(approval.id, 'approved', 'admin')

    expect(decided?.status).toBe('approved')
    expect(decided?.decidedBy).toBe('admin')
    expect(await decision).toBe('approved')
  })

  it('resolves a pending call when rejected', async () => {
    const approval = await createApproval({
      userId: 1,
      userName: USER,
      serverName: 'echo',
      toolName: TOOL,
      args: { text: 'bye' },
      ttlMs: 5000,
    })

    const decision = waitForDecision(approval.id, 5000)
    await decideApproval(approval.id, 'rejected', 'admin')
    expect(await decision).toBe('rejected')
  })

  it('returns null when the approval is no longer pending', async () => {
    const approval = await createApproval({
      userId: 1,
      userName: USER,
      serverName: 'echo',
      toolName: TOOL,
      args: {},
      ttlMs: 5000,
    })

    expect(await decideApproval(approval.id, 'approved', 'admin')).not.toBeNull()
    expect(await decideApproval(approval.id, 'approved', 'admin')).toBeNull()
    expect(await decideApproval(-1, 'approved', 'admin')).toBeNull()
  })

  it('expires a pending call after its ttl', async () => {
    const approval = await createApproval({
      userId: 1,
      userName: USER,
      serverName: 'echo',
      toolName: TOOL,
      args: {},
      ttlMs: 30,
    })

    expect(await waitForDecision(approval.id, 30)).toBe('expired')

    const stored = (await listApprovals(200)).find((a) => a.id === approval.id)
    expect(stored?.status).toBe('expired')
  })
})
