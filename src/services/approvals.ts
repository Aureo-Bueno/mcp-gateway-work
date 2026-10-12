import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { approvalRules, approvals, type ApprovalRow } from '../db/schema'
import { matchesPattern } from './access'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalRuleView {
  id: number
  toolPattern: string
  enabled: boolean
  createdAt: Date
}

export interface ApprovalView {
  id: number
  userId: number | null
  userName: string
  serverName: string
  toolName: string
  arguments: Record<string, unknown>
  status: ApprovalStatus
  decidedBy: string | null
  createdAt: Date
  decidedAt: Date | null
  expiresAt: Date
}

export interface CreateApprovalInput {
  userId: number | null
  userName: string
  serverName: string
  toolName: string
  args: Record<string, unknown>
  ttlMs: number
}

interface Waiter {
  resolve: (status: ApprovalStatus) => void
  timer: NodeJS.Timeout
}

const waiters = new Map<number, Waiter>()

const toView = (row: ApprovalRow): ApprovalView => ({
  id: row.id,
  userId: row.userId,
  userName: row.userName,
  serverName: row.serverName,
  toolName: row.toolName,
  arguments: row.argumentsJson,
  status: row.status,
  decidedBy: row.decidedBy,
  createdAt: row.createdAt,
  decidedAt: row.decidedAt,
  expiresAt: row.expiresAt,
})

export const requiresApproval = async (toolName: string): Promise<boolean> => {
  const rules = await getDb().select().from(approvalRules).where(eq(approvalRules.enabled, true))
  return rules.some((rule) => matchesPattern(toolName, rule.toolPattern))
}

export const listApprovalRules = async (): Promise<ApprovalRuleView[]> => {
  const rows = await getDb().select().from(approvalRules).orderBy(approvalRules.id)
  return rows.map((row) => ({
    id: row.id,
    toolPattern: row.toolPattern,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }))
}

export const createApprovalRule = async (toolPattern: string, enabled = true): Promise<ApprovalRuleView> => {
  const rows = await getDb()
    .insert(approvalRules)
    .values({ toolPattern, enabled })
    .onConflictDoUpdate({ target: approvalRules.toolPattern, set: { enabled } })
    .returning()

  const row = rows[0]
  if (row === undefined) {
    throw new Error('Failed to persist approval rule')
  }
  return { id: row.id, toolPattern: row.toolPattern, enabled: row.enabled, createdAt: row.createdAt }
}

export const deleteApprovalRule = async (id: number): Promise<boolean> => {
  const deleted = await getDb()
    .delete(approvalRules)
    .where(eq(approvalRules.id, id))
    .returning({ id: approvalRules.id })
  return deleted.length > 0
}

export const createApproval = async (input: CreateApprovalInput): Promise<ApprovalView> => {
  const expiresAt = new Date(Date.now() + input.ttlMs)

  const rows = await getDb()
    .insert(approvals)
    .values({
      userId: input.userId,
      userName: input.userName,
      serverName: input.serverName,
      toolName: input.toolName,
      argumentsJson: input.args,
      status: 'pending',
      expiresAt,
    })
    .returning()

  const row = rows[0]
  if (row === undefined) {
    throw new Error('Failed to persist approval request')
  }
  return toView(row)
}

const resolveWaiter = (id: number, status: ApprovalStatus): void => {
  const waiter = waiters.get(id)
  if (waiter !== undefined) {
    waiters.delete(id)
    clearTimeout(waiter.timer)
    waiter.resolve(status)
  }
}

export const waitForDecision = (id: number, ttlMs: number): Promise<ApprovalStatus> =>
  new Promise<ApprovalStatus>((resolve) => {
    const timer = setTimeout(() => {
      if (waiters.has(id)) {
        waiters.delete(id)
        void expireApproval(id).then(() => resolve('expired'))
      }
    }, ttlMs)

    waiters.set(id, { resolve, timer })
  })

const expireApproval = async (id: number): Promise<void> => {
  await getDb()
    .update(approvals)
    .set({ status: 'expired', decidedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
}

export const decideApproval = async (
  id: number,
  decision: 'approved' | 'rejected',
  decidedBy: string
): Promise<ApprovalView | null> => {
  const rows = await getDb()
    .update(approvals)
    .set({ status: decision, decidedBy, decidedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
    .returning()

  const row = rows[0]
  if (row === undefined) {
    return null
  }

  resolveWaiter(id, decision)
  return toView(row)
}

export const listApprovals = async (limit = 50): Promise<ApprovalView[]> => {
  const rows = await getDb().select().from(approvals).orderBy(desc(approvals.createdAt)).limit(limit)
  return rows.map(toView)
}
