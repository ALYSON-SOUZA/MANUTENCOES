import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  cpf: text('cpf').notNull().default(''),
  isMaster: boolean('is_master').notNull().default(false),
  lastLoginAt: timestamp('last_login_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const maintenanceRecords = pgTable('maintenance_records', {
  id: text('id').primaryKey(),
  ticketNumber: text('ticket_number').notNull(),
  category: text('category').notNull(),
  assetName: text('asset_name').notNull(),
  type: text('type').notNull(),
  performedDate: text('performed_date').notNull(),
  nextDate: text('next_date').notNull().default(''),
  warrantyDays: text('warranty_days').notNull().default(''),
  warrantyEndDate: text('warranty_end_date').notNull().default(''),
  value: doublePrecision('value').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdByMaster: boolean('created_by_master').notNull().default(false),
  updatedBy: text('updated_by').notNull(),
  updatedByMaster: boolean('updated_by_master').notNull().default(false),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name').notNull(),
  isMaster: boolean('is_master').notNull().default(false),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  records: many(maintenanceRecords),
  auditLogs: many(auditLogs),
}));

export const maintenanceRecordsRelations = relations(maintenanceRecords, ({ one }) => ({
  author: one(users, {
    fields: [maintenanceRecords.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));
