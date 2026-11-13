import { randomBytes } from 'node:crypto';
import { createDatabase } from '@farmacia/database';
import nodemailer from 'nodemailer';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { resolveUser } from './modules/auth/access.js';
import { registerAccessRoutes } from './modules/auth/access-routes.js';
import { readAuthConfig } from './modules/auth/auth-config.js';
import { createAuth } from './modules/auth/auth.js';
import { registerCatalogRoutes } from './modules/catalog/catalog.routes.js';
import { ensureInitialCatalog } from './modules/catalog/catalog.service.js';

const app = buildApp({
  logger: {
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  const config = readAuthConfig();
  if (config || process.env.DATABASE_URL) {
    const { db, pool } = createDatabase({ onPoolError: () => app.log.error('Database connection failed') });
    const seeded = await ensureInitialCatalog(db);
    registerCatalogRoutes(app, db);

    const defaultOrderPolicy = {
      locationIds: [seeded.locationId],
      reservationSeconds: 900,
      deliveryFeeClp: 1500,
    };

    if (config) {
      const mailer = nodemailer.createTransport(config.smtp);
      app.addHook('onClose', async () => {
        mailer.close();
        await pool.end();
      });
      const auth = createAuth(db, {
        origin: config.origin, secret: config.secret,
        async sendCode(email, code) {
          await mailer.sendMail({
            from: config.from, to: email, subject: 'Código de acceso a la Farmacia Comunitaria',
            text: `Tu código de acceso es ${code}. Vence en 5 minutos.`,
          });
        },
      });
      registerAccessRoutes(app, {
        db,
        auth,
        origin: config.origin,
        orderPolicy: config.orderPolicy ?? defaultOrderPolicy,
      });
    } else {
      app.addHook('onClose', async () => {
        await pool.end();
      });
      const localOrigin = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:5173';
      const localSecret = process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32
        ? process.env.BETTER_AUTH_SECRET
        : randomBytes(32).toString('hex');
      const localCodes = new Map<string, string>();
      const localGrantor = await resolveUser(db, 'system:local-dev-grantor');
      const auth = createAuth(db, {
        origin: localOrigin,
        secret: localSecret,
        async sendCode(email, code) {
          localCodes.set(email.trim().toLowerCase(), code);
        },
      });
      registerAccessRoutes(app, {
        db,
        auth,
        origin: localOrigin,
        orderPolicy: defaultOrderPolicy,
        localDevGrantorId: localGrantor.id,
        readLocalDevCode: (email) => localCodes.get(email),
      });
    }
  }
  await app.listen(readConfig());
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
