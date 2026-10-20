import { defineConfig } from 'drizzle-kit';
import { validateDatabaseUrl } from './src/config.ts';

const connectionString = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  ...(connectionString === undefined ? {} : {
    dbCredentials: { url: validateDatabaseUrl(connectionString) },
  }),
});
