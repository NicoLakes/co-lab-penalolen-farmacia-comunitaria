import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../../src/index.js';

test('dos consumidores independientes consultan la misma base PostgreSQL', async (t) => {
  const onPoolError = (error: Error) => { throw error; };
  const first = createDatabase({ onPoolError });
  t.after(() => first.pool.end());
  const second = createDatabase({ onPoolError });
  t.after(() => second.pool.end());

  const query = sql`select current_database() as database, 1::integer as value`;
  const [firstResult, secondResult] = await Promise.all([
    first.db.execute(query), second.db.execute(query),
  ]);

  assert.equal(firstResult.rows.length, 1);
  assert.equal(firstResult.rows[0]?.value, 1);
  assert.deepEqual(firstResult.rows, secondResult.rows);
});
