import { desc } from 'drizzle-orm'
import { getEnv } from '../config/env'
import { getDb } from '../db/client'
import { auditLogs, type AuditLogRow } from '../db/schema'
import { logger } from '../logger'
import type { AuditEntry } from '../types/index'
import { redactArguments } from './redaction'

/**
 * Persists an audit entry. The request payload is always passed through
 * argument redaction first, so secrets sent by the client (passwords, tokens,
 * API keys) never reach the database in clear text.
 */
export const recordAudit = async (entry: AuditEntry): Promise<void> => {
  const env = getEnv()
  const { result: request } = redactArguments(entry.request, {
    enabled: env.REDACTION_ENABLED,
    replacement: env.REDACTION_REPLACEMENT,
  })

  await getDb()
    .insert(auditLogs)
    .values({
      userId: entry.userId,
      method: entry.method ?? 'tools/call',
      serverName: entry.serverName,
      toolName: entry.toolName,
      requestJson: request,
      responseJson: entry.response,
      latencyMs: entry.latencyMs,
      status: entry.status,
    })
}

/**
 * Same as {@link recordAudit}, but never throws: a failed audit write is logged
 * and does not change the outcome the client sees (e.g. a tool that already ran
 * is not reported as failed just because the audit insert failed).
 */
export const safeRecordAudit = async (entry: AuditEntry): Promise<void> => {
  try {
    await recordAudit(entry)
  } catch (error) {
    logger.error(
      { err: error, method: entry.method ?? 'tools/call', tool: entry.toolName, status: entry.status },
      'Failed to write audit log entry'
    )
  }
}

export const listAuditLogs = async (limit = 100): Promise<AuditLogRow[]> =>
  getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit)
