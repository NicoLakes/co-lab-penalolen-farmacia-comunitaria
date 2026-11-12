import type { Database } from '@farmacia/database';
import { authSessions, authUsers, userRoles, users } from '@farmacia/database/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { authIssuer } from './auth.js';

const rolePermissions = {
  buyer: ['orders.create', 'orders.read_own', 'orders.cancel_own'],
  pharmacy_operator: ['orders.read_for_fulfillment', 'orders.fulfill'],
  user_admin: ['users.manage_access'],
} as const;

export type Role = keyof typeof rolePermissions;
export type Permission = typeof rolePermissions[Role][number];

export function permits(roles: Role[], permission: Permission) {
  return roles.some((role) => rolePermissions[role].some((allowed) => allowed === permission));
}

export function activeRoles(db: Database, userId: string) {
  return db.select({ role: userRoles.role }).from(userRoles)
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt))).orderBy(userRoles.role);
}

export async function resolveUser(db: Database, authId: string) {
  const identity = { identityIssuer: authIssuer, identitySubject: authId };
  const condition = and(eq(users.identityIssuer, authIssuer), eq(users.identitySubject, authId));
  const [existing] = await db.select().from(users).where(condition);
  if (existing) return existing;
  await db.insert(users).values(identity).onConflictDoNothing({ target: [users.identityIssuer, users.identitySubject] });
  const [created] = await db.select().from(users).where(condition);
  if (!created) throw new Error('Authenticated user was not provisioned');
  return created;
}

export async function findManagedUser(db: Database, email: string) {
  const [user] = await db.select({ id: users.id, email: authUsers.email, status: users.status }).from(authUsers)
    .innerJoin(users, and(eq(users.identityIssuer, authIssuer), eq(users.identitySubject, authUsers.id)))
    .where(eq(authUsers.email, email.trim().toLowerCase()));
  if (!user) return;
  return { ...user, roles: (await activeRoles(db, user.id)).map(({ role }) => role) };
}

export function setUserRole(db: Database, userId: string, role: Role, grant: boolean, actorId?: string) {
  if (!actorId && role !== 'user_admin') throw new Error('Role changes require a responsible user');
  if (actorId && (role === 'user_admin' || actorId === userId)) return 'forbidden' as const;
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.identityIssuer !== authIssuer) return 'not_found' as const;
    if (grant) {
      if (user.status !== 'active') return 'conflict' as const;
      await tx.insert(userRoles).values({ userId, role, grantedByUserId: actorId ?? null }).onConflictDoNothing();
    } else {
      await tx.update(userRoles).set({ revokedAt: sql`clock_timestamp()`, revokedByUserId: actorId ?? null })
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role), isNull(userRoles.revokedAt)));
    }
    return 'ok' as const;
  });
}

export function setUserStatus(db: Database, userId: string, status: 'active' | 'disabled', actorId: string) {
  if (actorId === userId) return 'forbidden' as const;
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.identityIssuer !== authIssuer) return 'not_found' as const;
    const [admin] = await tx.select({ id: userRoles.id }).from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'user_admin'), isNull(userRoles.revokedAt)));
    if (admin) return 'forbidden' as const;
    await tx.update(users).set({ status, updatedAt: sql`clock_timestamp()` }).where(eq(users.id, userId));
    if (status === 'disabled') await tx.delete(authSessions).where(eq(authSessions.userId, user.identitySubject));
    return 'ok' as const;
  });
}
