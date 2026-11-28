import { randomUUID } from 'node:crypto';
import type { Database } from '@farmacia/database';
import { authSessions, authUsers, userRoles, users } from '@farmacia/database/schema';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { authIssuer } from './auth.js';

const rolePermissions = {
  buyer: ['orders.create', 'orders.read_own', 'orders.cancel_own', 'orders.pay_own'],
  pharmacy_operator: ['orders.read_for_fulfillment', 'orders.fulfill', 'catalog.manage', 'inventory.manage'],
  user_admin: ['users.manage_access', 'inventory.read_audit'],
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

export async function listManagedUsers(db: Database, query?: string, limit = 50) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const trimmed = query?.trim().toLowerCase() ?? '';
  const escaped = trimmed.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const rows = await db.select({
    id: users.id,
    email: authUsers.email,
    status: users.status,
    createdAt: users.createdAt,
  }).from(authUsers)
    .innerJoin(users, and(eq(users.identityIssuer, authIssuer), eq(users.identitySubject, authUsers.id)))
    .where(trimmed ? sql`lower(${authUsers.email}) LIKE ${`%${escaped}%`} ESCAPE '\\'` : undefined)
    .orderBy(desc(users.createdAt), asc(authUsers.email))
    .limit(safeLimit);

  if (rows.length === 0) return [];
  const roleRows = await db.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles)
    .where(and(inArray(userRoles.userId, rows.map((row) => row.id)), isNull(userRoles.revokedAt)))
    .orderBy(userRoles.role);
  const rolesByUser = new Map<string, Role[]>();
  for (const row of roleRows) {
    const existing = rolesByUser.get(row.userId) ?? [];
    existing.push(row.role);
    rolesByUser.set(row.userId, existing);
  }
  return rows.map((row) => ({ ...row, roles: rolesByUser.get(row.id) ?? [] }));
}

export async function createManagedUser(
  db: Database,
  input: { email: string; roles?: readonly Role[] | undefined },
  actorId: string,
) {
  const email = input.email.trim().toLowerCase();
  const initialRoles = [...new Set(input.roles ?? [])].sort();
  return db.transaction(async (tx) => {
    const authUserId = randomUUID();
    const [createdAuth] = await tx.insert(authUsers).values({
      id: authUserId,
      name: '',
      email,
      emailVerified: true,
    }).onConflictDoNothing({ target: authUsers.email }).returning({ id: authUsers.id, email: authUsers.email });
    if (!createdAuth) return 'conflict' as const;

    const [createdUser] = await tx.insert(users).values({
      identityIssuer: authIssuer,
      identitySubject: createdAuth.id,
      status: 'active',
    }).returning();
    if (!createdUser) throw new Error('Managed user was not created');

    if (initialRoles.length > 0) {
      await tx.insert(userRoles).values(
        initialRoles.map((role) => ({ userId: createdUser.id, role, grantedByUserId: actorId })),
      );
    }

    return {
      id: createdUser.id,
      email: createdAuth.email,
      status: createdUser.status,
      createdAt: createdUser.createdAt,
      roles: initialRoles,
    };
  });
}

export function setUserRole(db: Database, userId: string, role: Role, grant: boolean, actorId?: string) {
  if (!actorId && role !== 'user_admin') throw new Error('Role changes require a responsible user');
  if (actorId && (actorId === userId || (role === 'user_admin' && !grant))) return 'forbidden' as const;
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
