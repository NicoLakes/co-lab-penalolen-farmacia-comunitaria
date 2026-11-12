import { randomUUID } from 'node:crypto';
import type { Database } from '@farmacia/database';
import { inventoryBalances, inventoryMovements, orderItems, orders, orderStatusEvents, stockReservations } from '@farmacia/database/schema';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { maxInteger, OrderError, orderUuid, requiredText } from './order-input.js';
import { findEligibleBalances, lockBalances } from './order-stock.js';
import type { OrderTransaction } from './order-stock.js';

interface OrderOperation {
  operationId: string;
  actorReference: string;
}

type Transition = OrderOperation & (
  { target: 'confirmed'; amountClp: bigint }
  | { target: 'fulfilled' }
  | { target: 'cancelled'; buyerId: string }
  | { target: 'expired' }
);

const reasons = {
  confirmed: 'Verified payment accepted',
  fulfilled: 'Order handed over or dispatched',
  cancelled: 'Buyer cancelled the unpaid order',
  expired: 'Unpaid reservation deadline elapsed',
};

async function closeReservations(tx: OrderTransaction, orderId: string, operation: Transition) {
  const reservations = await tx.select({ reservation: stockReservations }).from(stockReservations)
    .innerJoin(orderItems, eq(orderItems.id, stockReservations.orderItemId))
    .where(and(eq(orderItems.orderId, orderId), eq(stockReservations.status, 'active')));
  if (reservations.length === 0) throw new OrderError('conflict', 'Order has no active allocations');
  const balanceIds = reservations.map(({ reservation }) => reservation.balanceId);
  await lockBalances(tx, inArray(inventoryBalances.id, balanceIds));

  const fulfilled = operation.target === 'fulfilled';
  const movementIds = new Map<string, string>();
  if (fulfilled) {
    const eligible = await findEligibleBalances(tx, balanceIds);
    if (eligible.length !== balanceIds.length) {
      throw new OrderError('unavailable_product', 'An allocated balance is no longer eligible for fulfillment');
    }
    const movements = await tx.insert(inventoryMovements).values(reservations.map(({ reservation }) => ({
      balanceId: reservation.balanceId, movementType: 'sale' as const,
      quantityDelta: -reservation.quantity, operationId: operation.operationId,
      reason: reasons.fulfilled, actorReference: operation.actorReference,
    }))).returning({ id: inventoryMovements.id, balanceId: inventoryMovements.balanceId });
    for (const movement of movements) movementIds.set(movement.balanceId, movement.id);
  }
  for (const { reservation } of reservations) {
    const { balanceId, quantity } = reservation;
    await tx.update(inventoryBalances).set({
      reservedQuantity: sql`${inventoryBalances.reservedQuantity} - ${quantity}`,
      ...(fulfilled && { onHandQuantity: sql`${inventoryBalances.onHandQuantity} - ${quantity}` }),
      updatedAt: sql`clock_timestamp()`,
    }).where(eq(inventoryBalances.id, balanceId));
    await tx.update(stockReservations).set({
      status: fulfilled ? 'consumed' : 'released',
      consumedMovementId: movementIds.get(balanceId) ?? null,
      closedAt: sql`clock_timestamp()`,
    }).where(eq(stockReservations.id, reservation.id));
  }
}

async function changeOrder(db: Database, orderId: string, input: Transition) {
  const id = orderUuid(orderId);
  const operation = { ...input, operationId: orderUuid(input.operationId), actorReference: requiredText(input.actorReference) };
  return db.transaction(async (tx) => {
    const { target, operationId, actorReference } = operation;
    const [order] = await tx.select().from(orders).where(and(
      eq(orders.id, id), operation.target === 'cancelled' ? eq(orders.buyerId, operation.buyerId) : undefined,
    )).for('update');
    if (!order) throw new OrderError('not_found', 'Order not found');
    if (operation.target === 'confirmed' && operation.amountClp !== order.totalClp) {
      throw new OrderError('conflict', 'Verified payment must match the order total');
    }
    const [previous] = await tx.select().from(orderStatusEvents)
      .where(and(eq(orderStatusEvents.orderId, id), eq(orderStatusEvents.operationId, operationId)));
    if (previous) {
      if (previous.toStatus !== target || previous.actorReference !== actorReference) {
        throw new OrderError('conflict', 'Operation ID has already been used for another order transition');
      }
      return order;
    }

    if (target === 'expired' && order.status !== 'pending_payment') return null;
    if (order.status !== (target === 'fulfilled' ? 'confirmed' : 'pending_payment')) {
      throw new OrderError('conflict', 'Order state does not allow this operation');
    }
    const [deadline] = await tx.select({ elapsed: lte(orders.reservationExpiresAt, sql`clock_timestamp()`) })
      .from(orders).where(eq(orders.id, id));
    if (target === 'expired' && !deadline?.elapsed) return null;
    if (target === 'confirmed' && deadline?.elapsed) throw new OrderError('expired', 'Reservation deadline has elapsed');

    if (target === 'fulfilled') {
      // Inventory operations use the same advisory lock for the movement operation ID.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`);
      const [movement] = await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)
        .where(eq(inventoryMovements.operationId, operationId)).limit(1);
      if (movement) throw new OrderError('conflict', 'Operation ID has already been used for stock movements');
    }
    const [updated] = await tx.update(orders).set({ status: target, updatedAt: sql`clock_timestamp()` })
      .where(eq(orders.id, id)).returning();
    if (!updated) throw new Error('Order update did not return a row');
    if (target !== 'confirmed') await closeReservations(tx, id, operation);
    await tx.insert(orderStatusEvents).values({
      orderId: id, fromStatus: order.status, toStatus: target, reason: reasons[target], operationId, actorReference,
    });
    return updated;
  });
}

// The caller has already authenticated the payment source and verified the provider result for this order.
export async function confirmOrderPayment(db: Database, orderId: string, amountClp: bigint, operation: OrderOperation) {
  return changeOrder(db, orderId, { ...operation, target: 'confirmed', amountClp });
}

export async function cancelPendingOrder(db: Database, orderId: string, buyerId: string, operationId: string) {
  const buyer = orderUuid(buyerId);
  return changeOrder(db, orderId, { operationId, actorReference: `buyer:${buyer}`, buyerId: buyer, target: 'cancelled' });
}

// The caller authorizes staff and verifies that physical handover or dispatch occurred.
export async function fulfillOrder(db: Database, orderId: string, operation: OrderOperation) {
  return changeOrder(db, orderId, { ...operation, target: 'fulfilled' });
}

export async function expirePendingOrders(db: Database, limit = 100) {
  if (!Number.isInteger(limit) || limit <= 0 || limit > maxInteger) {
    throw new OrderError('invalid_input', 'Expiry batch size must be a positive integer');
  }
  const candidates = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.status, 'pending_payment'), lte(orders.reservationExpiresAt, sql`statement_timestamp()`)))
    .orderBy(orders.reservationExpiresAt, orders.id).limit(limit);
  let expired = 0;
  for (const { id } of candidates) {
    const result = await changeOrder(db, id, { operationId: randomUUID(), actorReference: 'system:order-expiration', target: 'expired' });
    if (result) expired++;
  }
  return expired;
}
