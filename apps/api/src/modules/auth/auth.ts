import type { Database } from '@farmacia/database';
import { authAccounts, authSessions, authUsers, authVerifications, users } from '@farmacia/database/schema';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { betterAuth } from 'better-auth/minimal';
import { emailOTP } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';

export const authIssuer = 'better-auth';

export function createAuth(db: Database, options: {
  origin: string;
  secret: string;
  sendCode: (email: string, code: string) => Promise<void>;
}) {
  return betterAuth({
    baseURL: options.origin,
    secret: options.secret,
    trustedOrigins: [options.origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: authUsers, account: authAccounts, session: authSessions, verification: authVerifications },
      transaction: true,
    }),
    advanced: {
      useSecureCookies: options.origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: ['x-farmacia-client-ip'] },
    },
    rateLimit: { enabled: true },
    logger: { disabled: true },
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            const [user] = await db.select({ status: users.status }).from(users).where(and(
              eq(users.identityIssuer, authIssuer), eq(users.identitySubject, session.userId),
            ));
            if (user?.status === 'disabled') throw new APIError('FORBIDDEN', { message: 'Account disabled' });
          },
        },
      },
    },
    plugins: [
      emailOTP({
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: 'encrypted',
        async sendVerificationOTP({ email, otp, type }) {
          if (type === 'sign-in') await options.sendCode(email, otp);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
