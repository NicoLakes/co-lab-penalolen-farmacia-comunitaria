import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase } from '@farmacia/database';
import { buildApp } from '../src/app.js';
import { registerOrderRoutes } from '../src/modules/orders/order-routes.js';

test('buyer payment cannot be confirmed when demo payments are disabled', async (t) => {
  const app = buildApp();
  const { db, pool } = createDatabase({
    connectionString: 'postgresql://unused@127.0.0.1:1/unused',
    onPoolError: (error) => { throw error; },
  });
  t.after(async () => {
    await app.close();
    await pool.end();
  });
  registerOrderRoutes(app, db, async () => ({ id: randomUUID(), email: 'buyer@example.test', roles: ['buyer'] }));
  const response = await app.inject({
    method: 'POST',
    url: `/api/orders/${randomUUID()}/pay`,
    payload: { operationId: randomUUID() },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { code: 'online_payment_unavailable' });
  assert.equal(pool.totalCount, 0);
});
