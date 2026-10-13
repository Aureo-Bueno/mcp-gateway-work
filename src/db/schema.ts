import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const profileTools = pgTable('profile_tools', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  toolPattern: text('tool_pattern').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  profileId: integer('profile_id')
    .notNull()
    .references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const servers = pgTable('servers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  type: text('type', { enum: ['stdio', 'http'] }).notNull(),
  command: text('command'),
  argsJson: jsonb('args_json').$type<string[] | null>(),
  envJson: jsonb('env_json').$type<Record<string, string> | null>(),
  url: text('url'),
  headersJson: jsonb('headers_json').$type<Record<string, string> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  method: text('method').notNull().default('tools/call'),
  serverName: text('server_name').notNull(),
  toolName: text('tool_name').notNull(),
  requestJson: jsonb('request_json').$type<unknown>().notNull(),
  responseJson: jsonb('response_json').$type<unknown>().notNull(),
  latencyMs: integer('latency_ms').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const approvalRules = pgTable('approval_rules', {
  id: serial('id').primaryKey(),
  toolPattern: text('tool_pattern').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  userName: text('user_name').notNull(),
  serverName: text('server_name').notNull(),
  toolName: text('tool_name').notNull(),
  argumentsJson: jsonb('arguments_json').$type<Record<string, unknown>>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'expired'] })
    .notNull()
    .default('pending'),
  decidedBy: text('decided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const gatewaySettings = pgTable('gateway_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Profile = typeof profiles.$inferSelect
export type ProfileTool = typeof profileTools.$inferSelect
export type User = typeof users.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type ServerRow = typeof servers.$inferSelect
export type AuditLogRow = typeof auditLogs.$inferSelect
export type ApprovalRule = typeof approvalRules.$inferSelect
export type ApprovalRow = typeof approvals.$inferSelect
