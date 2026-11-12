import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase } from '@farmacia/database';
import { getAvailableInventory, InventoryError, recordInventoryMovement, transferInventory } from '../src/modules/inventory/inventory.service.js';

test('invalid inventory operations fail before connecting to PostgreSQL', async (t) => {
  const { db, pool } = createDatabase({
    connectionString: 'postgresql://test:synthetic@127.0.0.1:1/unused',
    onPoolError: (error) => { throw error; },
  });
  t.after(() => pool.end());
  const input = { balanceId: randomUUID(), operationId: randomUUID(), reason: 'Count', movementType: 'adjustment' as const, quantityDelta: 1 };
  const invalid = (error: unknown) => error instanceof InventoryError && error.code === 'invalid_input';
  for (const quantityDelta of [0, 0.5, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(recordInventoryMovement(db, 'test:actor', { ...input, quantityDelta }), invalid);
  }
  await assert.rejects(recordInventoryMovement(db, 'test:actor', { ...input, movementType: 'receipt', quantityDelta: -1 }), invalid);
  await assert.rejects(recordInventoryMovement(db, 'test:actor', { ...input, reason: ' ' }), invalid);
  await assert.rejects(recordInventoryMovement(db, ' ', input), invalid);
  await assert.rejects(recordInventoryMovement(db, 'test:actor', { ...input, operationId: 'invalid' }), invalid);
  await assert.rejects(transferInventory(db, 'test:actor', {
    ...input, sourceBalanceId: input.balanceId, destinationBalanceId: input.balanceId, quantity: 1,
  }), invalid);
  await assert.rejects(transferInventory(db, 'test:actor', {
    ...input, sourceBalanceId: input.balanceId, destinationBalanceId: randomUUID(), quantity: -1,
  }), invalid);
  await assert.rejects(getAvailableInventory(db, 'invalid'), invalid);
  assert.equal(pool.totalCount, 0);
});
