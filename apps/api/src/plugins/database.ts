import fp from 'fastify-plugin';
import { createDatabase } from '@farmacia/database';
import type { Database } from '@farmacia/database';

declare module 'fastify' {
  interface FastifyInstance {
    // Cliente Drizzle compartido; se crea perezosamente si no se inyecta otro.
    db: Database;
  }
}

export interface DatabasePluginOptions {
  db?: Database;
}

// Conecta la API con PostgreSQL. Sin DATABASE_URL solo falla quien consulte,
// de modo que buildApp() sigue pudiéndose probar con inject sin base de datos.
export const databasePlugin = fp<DatabasePluginOptions>(
  async (app, options) => {
    let database = options.db;
    let poolCreado: { end(): Promise<void> } | undefined;

    Object.defineProperty(app, 'db', {
      configurable: true,
      get() {
        if (!database) {
          const creada = createDatabase({
            onPoolError: (error) => app.log.error(error),
          });
          database = creada.db;
          poolCreado = creada.pool;
        }
        return database;
      },
    });

    app.addHook('onClose', async () => {
      if (poolCreado) await poolCreado.end();
    });
  },
);
