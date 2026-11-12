import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Database } from '@farmacia/database';
import { inventoryBalances, inventoryLocations, inventoryLots, inventoryMovements, orderItems, orders, orderStatusEvents, products, stockReservations, users } from '@farmacia/database/schema';
import { eq, sql } from 'drizzle-orm';
import { getAvailableInventory, InventoryError, recordInventoryMovement } from '../../src/modules/inventory/inventory.service.js';
import { createOrder } from '../../src/modules/orders/create-order.js';
import { OrderError } from '../../src/modules/orders/order-input.js';
import type { CreateOrderInput, OrderPolicy } from '../../src/modules/orders/order-input.js';
import { cancelPendingOrder, confirmOrderPayment, expirePendingOrders, fulfillOrder } from '../../src/modules/orders/order-lifecycle.js';
import { isolatedDatabase } from './isolated-database.js';

const actorReference = 'test:authorized-order-process';
const operation = () => ({ actorReference, operationId: randomUUID() });
const hasCode = (code: OrderError['code']) => (error: unknown) => error instanceof OrderError && error.code === code;
const hasDatabaseCode = (code: string) => (error: unknown) => {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code;
};

async function buyer(db: Database) {
  const [row] = await db.insert(users).values({ identityIssuer: 'https://identity.example.test', identitySubject: randomUUID() }).returning();
  assert.ok(row);
  return row;
}

async function location(db: Database, isActive = true) {
  const [row] = await db.insert(inventoryLocations).values({ code: randomUUID(), name: randomUUID(), isActive }).returning();
  assert.ok(row);
  return row;
}

async function product(db: Database, overrides: Partial<typeof products.$inferInsert> = {}) {
  const [row] = await db.insert(products).values({
    code: randomUUID(), name: 'Synthetic purchase product', quantityUnit: 'package', isPublished: true,
    saleCondition: 'direct_sale', priceClp: 1500, inventoryTracking: 'quantity_only', ...overrides,
  }).returning();
  assert.ok(row);
  return row;
}

async function stock(db: Database, productId: string, locationId: string, quantity: number, expiresInDays?: number) {
  let lotId: string | null = null;
  if (expiresInDays !== undefined) {
    const [lot] = await db.insert(inventoryLots).values({
      productId, lotNumber: randomUUID(),
      expiresOn: sql`(statement_timestamp() AT TIME ZONE 'America/Santiago')::date + ${expiresInDays}::integer`,
    }).returning();
    assert.ok(lot);
    lotId = lot.id;
  }
  const [balance] = await db.insert(inventoryBalances).values({ productId, locationId, lotId }).returning();
  assert.ok(balance);
  if (quantity > 0) {
    await recordInventoryMovement(db, actorReference, {
      operationId: randomUUID(), balanceId: balance.id, movementType: 'opening',
      quantityDelta: quantity, reason: 'Synthetic opening stock',
    });
  }
  return balance;
}

function pickup(productId: string, quantity = 1): CreateOrderInput {
  return { idempotencyKey: randomUUID(), items: [{ productId, quantity }], fulfillment: { method: 'pickup' } };
}

function policy(...locationIds: string[]): OrderPolicy {
  return { locationIds, reservationSeconds: 300, deliveryFeeClp: 0 };
}

async function readBalance(db: Database, id: string) {
  const [balance] = await db.select({
    physical: inventoryBalances.onHandQuantity,
    reserved: inventoryBalances.reservedQuantity,
  }).from(inventoryBalances).where(eq(inventoryBalances.id, id));
  assert.ok(balance);
  return balance;
}

test('orders preserve stock, audit history and purchase details through their lifecycle', async (t) => {
  const db = await isolatedDatabase(t);

  await t.test('allocates eligible lots in expiry order and fulfills exactly once', async () => {
    const customer = await buyer(db);
    const active = await location(db);
    const inactive = await location(db, false);
    const outsideScope = await location(db);
    const item = await product(db, { inventoryTracking: 'lot_and_expiration', priceClp: 2_147_483_647 });
    const later = await stock(db, item.id, active.id, 8, 10);
    const sooner = await stock(db, item.id, active.id, 5, 5);
    const expiring = await stock(db, item.id, active.id, 20, 0);
    const inactiveStock = await stock(db, item.id, inactive.id, 20, 1);
    const outsideStock = await stock(db, item.id, outsideScope.id, 20, 1);
    const blocked = await stock(db, item.id, active.id, 20, 1);
    await db.update(inventoryBalances).set({ isBlocked: true }).where(eq(inventoryBalances.id, blocked.id));
    const details = { recipientName: 'Test recipient', phone: '123456789', address: 'Test address', commune: 'Test commune' };
    const input: CreateOrderInput = {
      ...pickup(item.id, 8), fulfillment: { method: 'delivery', details },
    };
    const deliveryPolicy = { ...policy(active.id, inactive.id), deliveryFeeClp: 125 };
    const [order, retry] = await Promise.all([
      createOrder(db, customer.id, input, deliveryPolicy), createOrder(db, customer.id, input, deliveryPolicy),
    ]);
    assert.deepEqual(retry, order);
    assert.equal(order.status, 'pending_payment');
    assert.match(order.orderNumber, /^FC-\d+$/);
    assert.deepEqual(order.deliveryDetailsSnapshot, details);
    assert.equal(order.subtotalClp, 17_179_869_176n);
    assert.equal(order.totalClp, 17_179_869_301n);
    assert.deepEqual(await readBalance(db, sooner.id), { physical: 5, reserved: 5 });
    assert.deepEqual(await readBalance(db, later.id), { physical: 8, reserved: 3 });
    for (const balance of [expiring, inactiveStock, outsideStock, blocked]) {
      assert.deepEqual(await readBalance(db, balance.id), { physical: 20, reserved: 0 });
    }
    assert.equal(await getAvailableInventory(db, item.id), 25n);
    await assert.rejects(createOrder(db, customer.id, { ...input, items: [{ productId: item.id, quantity: 9 }] }, deliveryPolicy), hasCode('conflict'));
    await assert.rejects(recordInventoryMovement(db, actorReference, {
      ...operation(), balanceId: sooner.id, movementType: 'adjustment', quantityDelta: -1, reason: 'Synthetic adjustment',
    }), (error: unknown) => error instanceof InventoryError && error.code === 'insufficient_stock');
    await db.update(products).set({ priceClp: 500, name: 'Renamed product' }).where(eq(products.id, item.id));
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    assert.equal(line?.unitPriceClp, 2_147_483_647);
    assert.equal(line?.productNameSnapshot, item.name);
    assert.equal(line?.lineTotalClp, order.subtotalClp);
    assert.deepEqual(await createOrder(db, customer.id, input, deliveryPolicy), order);

    await assert.rejects(confirmOrderPayment(db, order.id, order.totalClp - 1n, operation()), hasCode('conflict'));
    const payment = operation();
    const confirmed = await Promise.all([
      confirmOrderPayment(db, order.id, order.totalClp, payment), confirmOrderPayment(db, order.id, order.totalClp, payment),
    ]);
    assert.deepEqual(confirmed.map((row) => row?.status), ['confirmed', 'confirmed']);
    assert.deepEqual(await readBalance(db, sooner.id), { physical: 5, reserved: 5 });
    await assert.rejects(cancelPendingOrder(db, order.id, customer.id, randomUUID()), hasCode('conflict'));

    await db.update(inventoryBalances).set({ isBlocked: true }).where(eq(inventoryBalances.id, later.id));
    const fulfillment = operation();
    await assert.rejects(fulfillOrder(db, order.id, fulfillment), hasCode('unavailable_product'));
    assert.deepEqual(await readBalance(db, sooner.id), { physical: 5, reserved: 5 });
    assert.deepEqual(await db.select().from(inventoryMovements).where(eq(inventoryMovements.operationId, fulfillment.operationId)), []);
    await db.update(inventoryBalances).set({ isBlocked: false }).where(eq(inventoryBalances.id, later.id));
    const fulfilled = await Promise.all([fulfillOrder(db, order.id, fulfillment), fulfillOrder(db, order.id, fulfillment)]);
    assert.deepEqual(fulfilled.map((row) => row?.status), ['fulfilled', 'fulfilled']);
    assert.deepEqual(await readBalance(db, sooner.id), { physical: 0, reserved: 0 });
    assert.deepEqual(await readBalance(db, later.id), { physical: 5, reserved: 0 });
    const movements = await db.select().from(inventoryMovements).where(eq(inventoryMovements.operationId, fulfillment.operationId));
    assert.deepEqual(movements.map((row) => row.quantityDelta).sort(), [-3, -5]);
    assert.ok(movements.every((row) => row.movementType === 'sale'));
    assert.ok(line);
    const allocations = await db.select().from(stockReservations).where(eq(stockReservations.orderItemId, line.id));
    assert.equal(allocations.length, 2);
    assert.ok(allocations.every((row) => row.status === 'consumed' && row.closedAt
      && movements.some((movement) => movement.id === row.consumedMovementId && movement.balanceId === row.balanceId)));
    const history = await db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, order.id));
    assert.deepEqual(history.map((row) => row.toStatus).sort(), ['confirmed', 'fulfilled', 'pending_payment']);
    await assert.rejects(db.update(orderItems).set({ unitPriceClp: 1 }).where(eq(orderItems.id, line.id)), hasDatabaseCode('23514'));
    await assert.rejects(db.update(orders).set({ subtotalClp: 1n }).where(eq(orders.id, order.id)), hasDatabaseCode('23514'));
    await assert.rejects(db.delete(orderStatusEvents).where(eq(orderStatusEvents.orderId, order.id)), hasDatabaseCode('23514'));
  });

  await t.test('rolls back incomplete orders and protects the last unit from concurrent buyers', async () => {
    const first = await buyer(db);
    const second = await buyer(db);
    const pharmacy = await location(db);
    const item = await product(db);
    const other = await product(db);
    const balance = await stock(db, item.id, pharmacy.id, 1);
    const settings = policy(pharmacy.id);
    await assert.rejects(createOrder(db, first.id, {
      ...pickup(item.id), items: [{ productId: item.id, quantity: 1 }, { productId: other.id, quantity: 1 }],
    }, settings), hasCode('insufficient_stock'));
    assert.deepEqual(await db.select().from(orders).where(eq(orders.buyerId, first.id)), []);
    assert.deepEqual(await readBalance(db, balance.id), { physical: 1, reserved: 0 });
    const results = await Promise.allSettled([
      createOrder(db, first.id, pickup(item.id), settings), createOrder(db, second.id, pickup(item.id), settings),
    ]);
    const winner = results.find((result) => result.status === 'fulfilled')?.value;
    const loser = results.find((result) => result.status === 'rejected');
    assert.ok(winner && loser && hasCode('insufficient_stock')(loser.reason));
    assert.deepEqual(await readBalance(db, balance.id), { physical: 1, reserved: 1 });
    const otherBuyer = winner.buyerId === first.id ? second.id : first.id;
    await assert.rejects(cancelPendingOrder(db, winner.id, otherBuyer, randomUUID()), hasCode('not_found'));
    await assert.rejects(db.update(inventoryBalances).set({ reservedQuantity: 0 }).where(eq(inventoryBalances.id, balance.id)), hasDatabaseCode('23514'));
    const cancellation = randomUUID();
    const cancelled = await cancelPendingOrder(db, winner.id, winner.buyerId, cancellation);
    assert.equal(cancelled?.status, 'cancelled');
    assert.deepEqual(await cancelPendingOrder(db, winner.id, winner.buyerId, cancellation), cancelled);
    assert.deepEqual(await readBalance(db, balance.id), { physical: 1, reserved: 0 });
    assert.equal((await createOrder(db, otherBuyer, pickup(item.id), settings)).status, 'pending_payment');
  });

  await t.test('expires unpaid allocations once and rejects late payment without releasing paid stock', async () => {
    const customer = await buyer(db);
    const pharmacy = await location(db);
    const item = await product(db);
    const balance = await stock(db, item.id, pharmacy.id, 2);
    const settings = { ...policy(pharmacy.id), reservationSeconds: 2 };
    const paid = await createOrder(db, customer.id, pickup(item.id), settings);
    await confirmOrderPayment(db, paid.id, paid.totalClp, operation());
    const unpaid = await createOrder(db, customer.id, pickup(item.id), settings);
    await db.execute(sql`SELECT pg_sleep(greatest(0, extract(epoch FROM (${unpaid.reservationExpiresAt.toISOString()}::timestamptz - clock_timestamp()))) + 0.05)`);
    await assert.rejects(confirmOrderPayment(db, unpaid.id, unpaid.totalClp, operation()), hasCode('expired'));
    const released = await Promise.all([expirePendingOrders(db), expirePendingOrders(db)]);
    assert.equal(released.reduce((sum, count) => sum + count, 0), 1);
    assert.deepEqual(await readBalance(db, balance.id), { physical: 2, reserved: 1 });
    const [expired] = await db.select().from(orders).where(eq(orders.id, unpaid.id));
    const [confirmed] = await db.select().from(orders).where(eq(orders.id, paid.id));
    assert.equal(expired?.status, 'expired');
    assert.equal(confirmed?.status, 'confirmed');
    assert.equal(await expirePendingOrders(db), 0);
  });

  await t.test('rejects invalid requests and unsupported sale conditions', async () => {
    const customer = await buyer(db);
    const pharmacy = await location(db);
    const settings = policy(pharmacy.id);
    for (const overrides of [
      { isPublished: false }, { saleCondition: 'simple_prescription' }, { saleCondition: 'prescription_cheque' },
    ] as const) {
      const item = await product(db, overrides);
      await stock(db, item.id, pharmacy.id, 2);
      await assert.rejects(createOrder(db, customer.id, pickup(item.id), settings), hasCode('unavailable_product'));
    }
    const item = await product(db);
    await assert.rejects(createOrder(db, customer.id, pickup(item.id, 1.5), settings), hasCode('invalid_input'));
    await assert.rejects(createOrder(db, randomUUID(), pickup(item.id), settings), hasCode('not_found'));
    const input = pickup(item.id);
    await assert.rejects(createOrder(db, customer.id, { ...input, items: [...input.items, ...input.items] }, settings), hasCode('invalid_input'));
    await assert.rejects(createOrder(db, customer.id, {
      ...input, fulfillment: { method: 'delivery', details: { recipientName: '  ', phone: '1', address: 'Test', commune: 'Test' } },
    }, settings), hasCode('invalid_input'));
    assert.deepEqual(await db.select().from(orders).where(eq(orders.buyerId, customer.id)), []);
  });

  await t.test('rejects a reservation for a different product and an unaudited transition', async () => {
    const customer = await buyer(db);
    const pharmacy = await location(db);
    const item = await product(db);
    const other = await product(db);
    const wrongBalance = await stock(db, other.id, pharmacy.id, 1);
    await assert.rejects(db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values({
        buyerId: customer.id, fulfillmentMethod: 'pickup', subtotalClp: 1500n,
        reservationExpiresAt: sql`clock_timestamp() + interval '5 minutes'`, idempotencyKey: randomUUID(),
      }).returning();
      assert.ok(order);
      const [line] = await tx.insert(orderItems).values({
        orderId: order.id, productId: item.id, productCodeSnapshot: item.code, productNameSnapshot: item.name,
        quantityUnitSnapshot: item.quantityUnit, unitPriceClp: 1500, quantity: 1, saleConditionSnapshot: 'direct_sale',
      }).returning();
      assert.ok(line);
      await tx.insert(stockReservations).values({
        orderItemId: line.id, productId: item.id, balanceId: wrongBalance.id, quantity: 1,
      });
    }), hasDatabaseCode('23503'));
    await stock(db, item.id, pharmacy.id, 1);
    const order = await createOrder(db, customer.id, pickup(item.id), policy(pharmacy.id));
    await assert.rejects(db.update(orders).set({ status: 'confirmed' }).where(eq(orders.id, order.id)), hasDatabaseCode('23514'));
  });
});
