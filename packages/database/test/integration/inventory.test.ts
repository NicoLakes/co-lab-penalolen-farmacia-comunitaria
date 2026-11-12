import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { createDatabase } from '../../src/index.js';
import { inventoryBalances, inventoryLocations, inventoryLots, inventoryMovements, products, stockReservations } from '../../src/schema/index.js';

function hasDatabaseCode(code: string) {
  return (error: unknown): boolean => {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code;
  };
}

test('operational inventory enforces tracking, references, quantities and immutable history', async (t) => {
  const { db, pool } = createDatabase({ onPoolError: (error) => { throw error; } });
  t.after(() => pool.end());

  await assert.rejects(db.transaction(async (tx) => {
    const [pending, counted, tracked, otherTracked] = await tx.insert(products).values([
      { code: randomUUID(), name: 'Pending product', quantityUnit: 'package' },
      { code: randomUUID(), name: 'Counted product', quantityUnit: 'package', inventoryTracking: 'quantity_only' },
      { code: randomUUID(), name: 'Tracked product', quantityUnit: 'package', inventoryTracking: 'lot_and_expiration' },
      { code: randomUUID(), name: 'Other tracked product', quantityUnit: 'package', inventoryTracking: 'lot_and_expiration' },
    ]).returning();
    const [location, otherLocation] = await tx.insert(inventoryLocations).values([
      { code: randomUUID(), name: `Warehouse ${randomUUID()}` },
      { code: randomUUID(), name: `Pharmacy ${randomUUID()}` },
    ]).returning();
    assert.ok(pending && counted && tracked && otherTracked && location && otherLocation);
    assert.equal(pending.inventoryTracking, null);
    assert.equal(location.isActive, true);
    const lotInput = { productId: tracked.id, lotNumber: 'LOT-001', expiresOn: '2030-12-31' };
    const [lot] = await tx.insert(inventoryLots).values(lotInput).returning();
    assert.ok(lot);
    const balanceInput = { productId: counted.id, locationId: location.id };
    const [balance] = await tx.insert(inventoryBalances).values(balanceInput).returning();
    const [trackedBalance] = await tx.insert(inventoryBalances)
      .values({ productId: tracked.id, locationId: location.id, lotId: lot.id }).returning();
    assert.ok(balance && trackedBalance);
    assert.equal(balance.onHandQuantity, 0);
    assert.equal(balance.reservedQuantity, 0);
    assert.equal(balance.isBlocked, false);
    assert.equal(balance.lotId, null);
    assert.ok(balance.updatedAt instanceof Date && lot.createdAt instanceof Date);

    const invalid = async (operation: (nested: typeof tx) => Promise<unknown>, code = '23514') => {
      await assert.rejects(tx.transaction(operation), hasDatabaseCode(code));
    };
    await invalid((nested) => nested.insert(inventoryBalances).values({ ...balanceInput, productId: pending.id }));
    await invalid((nested) => nested.insert(inventoryLots).values({ ...lotInput, productId: pending.id }));
    await invalid((nested) => nested.insert(inventoryLots).values({ ...lotInput, productId: counted.id }));
    await invalid((nested) => nested.insert(inventoryBalances).values(balanceInput), '23505');
    await invalid((nested) => nested.insert(inventoryBalances).values({ ...balanceInput, lotId: lot.id }));
    await invalid((nested) => nested.insert(inventoryBalances)
      .values({ productId: tracked.id, locationId: otherLocation.id }));
    await invalid((nested) => nested.insert(inventoryBalances)
      .values({ productId: otherTracked.id, locationId: otherLocation.id, lotId: lot.id }), '23503');
    await invalid((nested) => nested.insert(inventoryBalances)
      .values({ productId: tracked.id, locationId: location.id, lotId: lot.id }), '23505');
    await invalid((nested) => nested.insert(inventoryLots).values(lotInput), '23505');
    for (const lotNumber of ['', ' ', '\t\n', ' LOT-002 ']) {
      await invalid((nested) => nested.insert(inventoryLots).values({ ...lotInput, lotNumber }));
    }
    await invalid((nested) => nested.insert(inventoryLots)
      .values({ ...lotInput, lotNumber: 'INFINITE', expiresOn: 'infinity' }));
    await invalid((nested) => nested.execute(sql`INSERT INTO ${inventoryLots}
      (product_id, lot_number) VALUES (${tracked.id}, 'MISSING-EXPIRY')`), '23502');
    for (const onHandQuantity of [-1, 0.5]) {
      await invalid((nested) => nested.update(inventoryBalances).set({ onHandQuantity })
        .where(eq(inventoryBalances.id, balance.id)), onHandQuantity < 0 ? '23514' : '22P02');
    }
    for (const reservedQuantity of [-1, 1]) {
      await invalid(async (nested) => {
        await nested.update(inventoryBalances).set({ reservedQuantity, onHandQuantity: 10 })
          .where(eq(inventoryBalances.id, balance.id));
        await nested.execute(sql`SET CONSTRAINTS inventory_reservation_counter_guard IMMEDIATE`);
      });
    }
    await invalid((nested) => nested.update(products).set({ inventoryTracking: 'lot_and_expiration' })
      .where(eq(products.id, counted.id)));
    await invalid((nested) => nested.update(products).set({ inventoryTracking: null })
      .where(eq(products.id, tracked.id)));
    await invalid((nested) => nested.update(products).set({ quantityUnit: 'tablet' })
      .where(eq(products.id, counted.id)));
    await invalid((nested) => nested.update(inventoryBalances).set({ locationId: otherLocation.id })
      .where(eq(inventoryBalances.id, balance.id)));
    await invalid((nested) => nested.update(inventoryLots).set({ expiresOn: '2031-12-31' })
      .where(eq(inventoryLots.id, lot.id)));
    await invalid((nested) => nested.execute(sql`UPDATE ${products} SET inventory_tracking = 'unknown'
      WHERE id = ${pending.id}`), '22P02');

    const movement = {
      balanceId: balance.id, movementType: 'receipt' as const, quantityDelta: 5,
      reason: 'Approved receipt', operationId: randomUUID(), actorReference: 'test:inventory',
    };
    await tx.update(inventoryBalances).set({ onHandQuantity: 5 }).where(eq(inventoryBalances.id, balance.id));
    const [recorded] = await tx.insert(inventoryMovements).values(movement).returning();
    assert.ok(recorded && recorded.createdAt instanceof Date);
    await invalid((nested) => nested.insert(inventoryMovements).values(movement), '23505');
    for (const quantityDelta of [0, -1]) {
      await invalid((nested) => nested.insert(inventoryMovements)
        .values({ ...movement, operationId: randomUUID(), quantityDelta }));
    }
    await invalid((nested) => nested.insert(inventoryMovements)
      .values({ ...movement, operationId: randomUUID(), movementType: 'sale' }));
    await invalid((nested) => nested.insert(inventoryMovements)
      .values({ ...movement, operationId: randomUUID(), reason: '\t\n' }));
    await invalid((nested) => nested.insert(inventoryMovements)
      .values({ ...movement, operationId: randomUUID(), actorReference: ' ' }));
    await invalid((nested) => nested.insert(inventoryMovements)
      .values({ ...movement, operationId: randomUUID(), balanceId: randomUUID() }), '23503');
    await invalid((nested) => nested.update(inventoryMovements).set({ reason: 'Rewritten' })
      .where(eq(inventoryMovements.id, recorded.id)));
    await invalid((nested) => nested.delete(inventoryMovements).where(eq(inventoryMovements.id, recorded.id)));
    // Include the referencing table so PostgreSQL reaches the history guard.
    await invalid((nested) => nested.execute(sql`TRUNCATE ${inventoryMovements}, ${stockReservations}`));
    await invalid((nested) => nested.delete(inventoryBalances).where(eq(inventoryBalances.id, balance.id)), '23503');
    await invalid((nested) => nested.delete(inventoryLots).where(eq(inventoryLots.id, lot.id)), '23503');
    await invalid((nested) => nested.delete(inventoryLocations).where(eq(inventoryLocations.id, location.id)), '23503');
    await invalid((nested) => nested.delete(products).where(eq(products.id, tracked.id)), '23503');
    tx.rollback();
  }), TransactionRollbackError);
});
