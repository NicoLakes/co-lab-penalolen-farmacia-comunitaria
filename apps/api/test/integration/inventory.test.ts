import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Database } from '@farmacia/database';
import { inventoryBalances, inventoryLocations, inventoryLots, inventoryMovements, products } from '@farmacia/database/schema';
import { eq, sql } from 'drizzle-orm';
import { getAvailableInventory, InventoryError, recordInventoryMovement, transferInventory } from '../../src/modules/inventory/inventory.service.js';

import { isolatedDatabase } from './isolated-database.js';

const actor = 'test:authorized-inventory-process';
const reason = 'Verified synthetic inventory count';
const hasCode = (code: InventoryError['code']) => (error: unknown) => error instanceof InventoryError && error.code === code;

async function fixture(db: Database, tracking: NonNullable<typeof products.$inferSelect.inventoryTracking> = 'quantity_only') {
  const [product] = await db.insert(products).values({
    code: randomUUID(), name: 'Synthetic inventory product', quantityUnit: 'package', inventoryTracking: tracking,
  }).returning();
  const [sourceLocation, destinationLocation] = await db.insert(inventoryLocations).values([
    { code: randomUUID(), name: `Source ${randomUUID()}` },
    { code: randomUUID(), name: `Destination ${randomUUID()}` },
  ]).returning();
  assert.ok(product && sourceLocation && destinationLocation);
  let lotId: string | null = null;
  if (tracking === 'lot_and_expiration') {
    const [lot] = await db.insert(inventoryLots).values({
      productId: product.id, lotNumber: 'TEST-LOT',
      expiresOn: sql`(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::date + 1`,
    }).returning();
    assert.ok(lot);
    lotId = lot.id;
  }
  const [source, destination] = await db.insert(inventoryBalances).values([
    { productId: product.id, locationId: sourceLocation.id, lotId },
    { productId: product.id, locationId: destinationLocation.id, lotId },
  ]).returning();
  assert.ok(source && destination);
  return { product, source, destination, sourceLocation, destinationLocation };
}

test('inventory services preserve atomicity, idempotency and concurrent stock integrity', async (t) => {
  const db = await isolatedDatabase(t);

  await t.test('opening, receipts and compensating adjustments have idempotent audit records', async () => {
    const { source, destination } = await fixture(db);
    const opening = { balanceId: source.id, movementType: 'opening' as const, quantityDelta: 10, operationId: randomUUID(), reason };
    const first = await recordInventoryMovement(db, actor, opening);
    const repeated = await recordInventoryMovement(db, actor, { ...opening, operationId: opening.operationId.toUpperCase() });
    assert.deepEqual(repeated, first);
    await assert.rejects(recordInventoryMovement(db, actor, { ...opening, quantityDelta: 11 }), hasCode('conflict'));
    await assert.rejects(recordInventoryMovement(db, 'test:another-actor', opening), hasCode('conflict'));
    await assert.rejects(recordInventoryMovement(db, actor, { ...opening, reason: 'Changed reason' }), hasCode('conflict'));
    await assert.rejects(recordInventoryMovement(db, actor, { ...opening, balanceId: destination.id }), hasCode('conflict'));
    await assert.rejects(recordInventoryMovement(db, actor, { ...opening, operationId: randomUUID() }), hasCode('conflict'));
    await recordInventoryMovement(db, actor, { ...opening, movementType: 'receipt', operationId: randomUUID(), quantityDelta: 5 });
    await recordInventoryMovement(db, actor, { ...opening, movementType: 'adjustment', operationId: randomUUID(), quantityDelta: -2 });
    const [balance] = await db.select().from(inventoryBalances).where(eq(inventoryBalances.id, source.id));
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.balanceId, source.id));
    assert.equal(balance?.onHandQuantity, 13);
    assert.equal(movements.length, 3);
    assert.equal(movements.reduce((sum, row) => sum + row.quantityDelta, 0), 13);
    await assert.rejects(recordInventoryMovement(db, actor, { ...opening, balanceId: randomUUID(), operationId: randomUUID() }), hasCode('not_found'));
  });

  await t.test('transfers link both movements and reject a different product or lot', async () => {
    const { source, destination, product } = await fixture(db, 'lot_and_expiration');
    await recordInventoryMovement(db, actor, { balanceId: source.id, movementType: 'opening', quantityDelta: 10, operationId: randomUUID(), reason });
    const transfer = { sourceBalanceId: source.id, destinationBalanceId: destination.id, quantity: 4, operationId: randomUUID(), reason };
    const first = await transferInventory(db, actor, transfer);
    assert.equal(first.length, 2);
    assert.equal(first.reduce((sum, movement) => sum + movement.quantityDelta, 0), 0);
    assert.deepEqual(new Set(first.map((row) => row.movementType)), new Set(['transfer_in', 'transfer_out']));
    assert.ok(first.every((row) => row.operationId === transfer.operationId));
    assert.deepEqual(await transferInventory(db, actor, transfer), first);
    const [otherLot] = await db.insert(inventoryLots).values({ productId: product.id, lotNumber: 'OTHER-LOT', expiresOn: '2035-01-01' }).returning();
    assert.ok(otherLot);
    const [otherLotBalance] = await db.insert(inventoryBalances).values({ productId: product.id, locationId: destination.locationId, lotId: otherLot.id }).returning();
    assert.ok(otherLotBalance);
    await assert.rejects(transferInventory(db, actor, { ...transfer, destinationBalanceId: otherLotBalance.id, operationId: randomUUID() }), hasCode('conflict'));
    const otherProduct = await fixture(db);
    await assert.rejects(transferInventory(db, actor, { ...transfer, destinationBalanceId: otherProduct.source.id, operationId: randomUUID() }), hasCode('conflict'));
    const balances = await db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, product.id));
    assert.equal(balances.find((row) => row.id === source.id)?.onHandQuantity, 6);
    assert.equal(balances.find((row) => row.id === destination.id)?.onHandQuantity, 4);
  });

  await t.test('a failed destination update rolls back the source and both audit records', async () => {
    const fixtureRows = await fixture(db);
    const [source, destination] = [fixtureRows.source, fixtureRows.destination].sort((a, b) => a.id.localeCompare(b.id));
    assert.ok(source && destination);
    for (const [balanceId, quantityDelta] of [[source.id, 10], [destination.id, 2_147_483_647]] as const) {
      await recordInventoryMovement(db, actor, { balanceId, movementType: 'opening', quantityDelta, operationId: randomUUID(), reason });
    }
    const before = await db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, source.productId)).orderBy(inventoryBalances.id);
    const operationId = randomUUID();
    await assert.rejects(transferInventory(db, actor, { sourceBalanceId: source.id, destinationBalanceId: destination.id, quantity: 1, operationId, reason }), hasCode('conflict'));
    assert.deepEqual(await db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, source.productId)).orderBy(inventoryBalances.id), before);
    assert.deepEqual(await db.select().from(inventoryMovements).where(eq(inventoryMovements.operationId, operationId)), []);
  });

  await t.test('only one concurrent adjustment can consume the last unit', async () => {
    const { source } = await fixture(db);
    await recordInventoryMovement(db, actor, { balanceId: source.id, movementType: 'opening', quantityDelta: 1, operationId: randomUUID(), reason });
    const results = await Promise.allSettled([0, 1].map(() => recordInventoryMovement(db, actor, {
      balanceId: source.id, movementType: 'adjustment', quantityDelta: -1, operationId: randomUUID(), reason,
    })));
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    const rejected = results.find((row) => row.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && hasCode('insufficient_stock')(rejected.reason));
    const [balance] = await db.select().from(inventoryBalances).where(eq(inventoryBalances.id, source.id));
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.balanceId, source.id));
    assert.equal(balance?.onHandQuantity, 0);
    assert.equal(movements.length, 2);
    assert.equal(movements.reduce((sum, row) => sum + row.quantityDelta, 0), 0);
  });

  await t.test('concurrent retries post a receipt once and opposite transfers finish consistently', async () => {
    const { source, destination, product } = await fixture(db);
    const input = { balanceId: source.id, movementType: 'receipt' as const, quantityDelta: 2, operationId: randomUUID(), reason };
    const [first, second] = await Promise.all([recordInventoryMovement(db, actor, input), recordInventoryMovement(db, actor, input)]);
    assert.deepEqual(first, second);
    await recordInventoryMovement(db, actor, { ...input, balanceId: destination.id, operationId: randomUUID() });
    await Promise.all([
      transferInventory(db, actor, { sourceBalanceId: source.id, destinationBalanceId: destination.id, quantity: 1, operationId: randomUUID(), reason }),
      transferInventory(db, actor, { sourceBalanceId: destination.id, destinationBalanceId: source.id, quantity: 1, operationId: randomUUID(), reason }),
    ]);
    const balances = await db.select().from(inventoryBalances).where(eq(inventoryBalances.productId, product.id));
    assert.deepEqual(balances.map((row) => row.onHandQuantity), [2, 2]);
  });

  await t.test('availability excludes blocked, inactive, expired and expiration-day stock', async () => {
    const { source, destination, product, sourceLocation } = await fixture(db);
    for (const [balanceId, quantityDelta] of [[source.id, 7], [destination.id, 3]] as const) {
      await recordInventoryMovement(db, actor, { balanceId, quantityDelta, movementType: 'opening', operationId: randomUUID(), reason });
    }
    await db.update(inventoryBalances).set({ isBlocked: true }).where(eq(inventoryBalances.id, destination.id));
    assert.equal(await getAvailableInventory(db, product.id), 7n);
    await db.update(inventoryLocations).set({ isActive: false }).where(eq(inventoryLocations.id, sourceLocation.id));
    assert.equal(await getAvailableInventory(db, product.id), 0n);
    const tracked = await fixture(db, 'lot_and_expiration');
    await recordInventoryMovement(db, actor, { balanceId: tracked.source.id, quantityDelta: 5, movementType: 'opening', operationId: randomUUID(), reason });
    for (const days of [-1, 0]) {
      const [lot] = await db.insert(inventoryLots).values({
        productId: tracked.product.id, lotNumber: `EXPIRATION-${days}`,
        expiresOn: sql`(CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::date + ${days}::integer`,
      }).returning();
      assert.ok(lot);
      const [balance] = await db.insert(inventoryBalances).values({ productId: tracked.product.id, locationId: tracked.sourceLocation.id, lotId: lot.id }).returning();
      assert.ok(balance);
      await recordInventoryMovement(db, actor, { balanceId: balance.id, quantityDelta: 100, movementType: 'opening', operationId: randomUUID(), reason });
    }
    assert.equal(await getAvailableInventory(db, tracked.product.id), 5n);
    await db.update(inventoryBalances).set({ isBlocked: true }).where(eq(inventoryBalances.id, tracked.source.id));
    assert.equal(await getAvailableInventory(db, tracked.product.id), 0n);
    const [pending] = await db.insert(products).values({ code: randomUUID(), name: 'Pending', quantityUnit: 'package' }).returning();
    assert.ok(pending);
    assert.equal(await getAvailableInventory(db, pending.id), 0n);
  });

  await t.test('aggregate availability preserves integer precision across balances', async () => {
    const { source, destination, product } = await fixture(db);
    for (const balanceId of [source.id, destination.id]) {
      await recordInventoryMovement(db, actor, { balanceId, quantityDelta: 2_147_483_647, movementType: 'opening', operationId: randomUUID(), reason });
    }
    assert.equal(await getAvailableInventory(db, product.id), 4_294_967_294n);
  });
});
