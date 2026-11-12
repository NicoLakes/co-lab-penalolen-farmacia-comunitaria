import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { createDatabase } from '@farmacia/database';
import { sql } from 'drizzle-orm';

export async function isolatedDatabase(t: TestContext) {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'DATABASE_URL must point to a dedicated migrated test database');
  const admin = createDatabase({ connectionString, onPoolError: (error) => { throw error; } });
  const namespace = `api_integration_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(connectionString);
  url.searchParams.set('options', `${url.searchParams.get('options') ?? ''} -c search_path=${namespace}`.trim());
  const runtime = createDatabase({ connectionString: url.toString(), onPoolError: (error) => { throw error; } });
  t.after(async () => {
    try {
      await runtime.pool.end();
      await admin.db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(namespace)} CASCADE`);
    } finally {
      await admin.pool.end();
    }
  });
  await admin.db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA ${sql.identifier(namespace)}`);
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(namespace)}`);
    const directory = new URL('../../../../packages/database/migrations/', import.meta.url);
    const filenames = (await readdir(directory)).filter((filename) => /^\d{4}_.+\.sql$/.test(filename)).sort();
    for (const filename of filenames) {
      const migration = await readFile(new URL(filename, directory), 'utf8');
      // The generated namespace contains only a fixed prefix and UUID hex digits.
      await tx.execute(sql.raw(migration.replaceAll('"public".', `"${namespace}".`)));
    }
  });
  return runtime.db;
}
