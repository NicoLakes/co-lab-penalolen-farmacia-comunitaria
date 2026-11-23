import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Database } from '@farmacia/database';
import { startOrderExpirationJob } from '../src/modules/orders/order-expiration-job.js';

const fakeDb = {} as Database;

test('startOrderExpirationJob logs expired counts and avoids overlapping sweeps', async () => {
  const infos: { obj: Record<string, unknown>; message: string }[] = [];
  const errors: { obj: Record<string, unknown>; message: string }[] = [];
  let releaseFirst!: () => void;
  let calls = 0;

  const job = startOrderExpirationJob(
    fakeDb,
    {
      info(obj, message) { infos.push({ obj, message }); },
      error(obj, message) { errors.push({ obj, message }); },
    },
    {
      intervalMs: 60_000,
      batchSize: 25,
      runBatch: async (_db, limit) => {
        calls += 1;
        assert.equal(limit, 25);
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return 3;
      },
    },
  );

  try {
    const first = job.sweep();
    const overlapping = job.sweep();
    await overlapping;
    assert.equal(calls, 1);
    releaseFirst();
    await first;
    assert.equal(errors.length, 0);
    assert.deepEqual(infos, [{ obj: { expired: 3 }, message: 'Expired unpaid order reservations' }]);
  } finally {
    job.stop();
  }
});

test('startOrderExpirationJob catches errors without crashing and stops cleanly', async () => {
  const errors: { obj: Record<string, unknown>; message: string }[] = [];
  let calls = 0;

  const job = startOrderExpirationJob(
    fakeDb,
    {
      info() {},
      error(obj, message) { errors.push({ obj, message }); },
    },
    {
      intervalMs: 60_000,
      runBatch: async () => {
        calls += 1;
        throw new Error('database unavailable');
      },
    },
  );

  await job.sweep();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);

  job.stop();
  await job.sweep();
  assert.equal(calls, 1);
});
