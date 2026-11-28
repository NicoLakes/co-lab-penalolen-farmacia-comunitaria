import { createDatabase } from '@farmacia/database';
import nodemailer from 'nodemailer';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { registerAccessRoutes } from './modules/auth/access-routes.js';
import { readAuthConfig } from './modules/auth/auth-config.js';
import { createAuth } from './modules/auth/auth.js';
import { registerCatalogRoutes } from './modules/catalog/catalog.routes.js';
import { startOrderExpirationJob } from './modules/orders/order-expiration-job.js';
import { createLocalPrescriptionStorage } from './modules/orders/prescription-storage.js';

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
    const expirationJob = startOrderExpirationJob(db, app.log);
    app.addHook('onClose', async () => {
      expirationJob.stop();
      await pool.end();
    });
    registerCatalogRoutes(app, db, config?.orderPolicy);
    if (config) {
      const mailer = nodemailer.createTransport(config.smtp);
      app.addHook('onClose', async () => { mailer.close(); });
      const prescriptionStorage = createLocalPrescriptionStorage(config.prescriptionStorageDir);
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
        orderPolicy: config.orderPolicy,
        prescriptionStorage,
        async sendEmail({ to, subject, text }) {
          await mailer.sendMail({ from: config.from, to, subject, text });
        },
      });
    }
  }
  await app.listen(readConfig());
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
