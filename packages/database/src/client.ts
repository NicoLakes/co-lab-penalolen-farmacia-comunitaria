import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateDatabaseUrl } from './config.js';
import * as schema from './schema/index.js';

export interface DatabaseOptions {
  connectionString?: string;
  onPoolError: (error: Error) => void;
}

export function createDatabase(options: DatabaseOptions) {
  const pool = new Pool({
    connectionString: validateDatabaseUrl(options.connectionString ?? process.env.DATABASE_URL),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', options.onPoolError);

  return { db: drizzle({ client: pool, schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
