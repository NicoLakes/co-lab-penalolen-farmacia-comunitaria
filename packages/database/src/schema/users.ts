import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const userRole = pgEnum('user_role', ['buyer', 'pharmacy_operator', 'user_admin']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  identityIssuer: text('identity_issuer').notNull(),
  identitySubject: text('identity_subject').notNull(),
  status: userStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('users_identity_unique').on(table.identityIssuer, table.identitySubject),
  check('users_identity_not_blank', sql`${table.identityIssuer} ~ '[^[:space:]]' AND ${table.identitySubject} ~ '[^[:space:]]'`),
]);

export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: userRole('role').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedByUserId: uuid('granted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
}, (table) => [
  uniqueIndex('user_roles_active_unique').on(table.userId, table.role).where(sql`${table.revokedAt} IS NULL`),
  check('user_roles_grant_actor', sql`${table.role} = 'user_admin' OR ${table.grantedByUserId} IS NOT NULL`),
  check('user_roles_revocation_valid', sql`
    (${table.revokedAt} IS NULL AND ${table.revokedByUserId} IS NULL)
    OR (${table.revokedAt} >= ${table.grantedAt} AND ${table.revokedAt} IS NOT NULL
        AND (${table.role} = 'user_admin' OR ${table.revokedByUserId} IS NOT NULL))
  `),
]);
