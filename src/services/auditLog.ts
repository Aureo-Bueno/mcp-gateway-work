import { desc } from 'drizzle-orm'
import { getDb } from '../db/client'
import { auditLogs, type AuditLogRow } from '../db/schema'
import type { AuditEntry } from '../types/index'

export const recordAudit = async (entry: AuditEntry): Promise<void> => {
  await getDb()
    .insert(auditLogs)
    .values({
      userId: entry.userId,
      serverName: entry.serverName,
      toolName: entry.toolName,
      requestJson: entry.request,
      responseJson: entry.response,
      latencyMs: entry.latencyMs,
      status: entry.status,
    })
}

export const listAuditLogs = async (limit = 100): Promise<AuditLogRow[]> =>
  getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit)
