import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Database } from '@farmacia/database';
import {
  authUsers,
  inventoryBalances,
  inventoryLocations,
  inventoryLots,
  inventoryMovements,
  orderItems,
  orders,
  orderStatusEvents,
  products,
  stockReservations,
  users,
} from '@farmacia/database/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authIssuer } from '../auth/auth.js';
import { eligibleInventory } from '../inventory/inventory.service.js';
import { maxClp, maxInteger, OrderError, orderUuid } from './order-input.js';
import type { OrderPolicy } from './order-input.js';
import { lockBalances } from './order-stock.js';

export const inPersonPaymentMethods = ['cash', 'card', 'bank_transfer'] as const;
export type InPersonPaymentMethod = typeof inPersonPaymentMethods[number];

const PAYMENT_LABELS: Record<InPersonPaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank_transfer: 'Transferencia',
};

const WALK_IN_ISSUER = 'system';
const WALK_IN_SUBJECT = 'walk-in-counter';

export interface CreateInPersonOrderInput {
  idempotencyKey: string;
  buyerEmail?: string | null | undefined;
  paymentMethod: InPersonPaymentMethod;
  items: readonly { productId: string; quantity: number }[];
}

export async function createInPersonOrder(
  db: Database,
  staffUserId: string,
  input: CreateInPersonOrderInput,
  policy: OrderPolicy,
) {
  const staffId = orderUuid(staffUserId);
  const idempotencyKey = orderUuid(input.idempotencyKey);
  if (!inPersonPaymentMethods.includes(input.paymentMethod)) {
    throw new OrderError('invalid_input', 'Unsupported payment method');
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || policy.locationIds.length === 0) {
    throw new OrderError('invalid_input', 'Order items and fulfillment locations must be valid');
  }

  const normalizedItems = input.items.map((item) => {
    if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > maxInteger) {
      throw new OrderError('invalid_input', 'Item quantity must be a positive integer');
    }
    return { productId: orderUuid(item.productId), quantity: item.quantity };
  }).sort((first, second) => first.productId.localeCompare(second.productId));

  if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
    throw new OrderError('invalid_input', 'Include each product only once');
  }

  const locationIds = [...new Set(policy.locationIds.map(orderUuid))];
  const buyerEmail = input.buyerEmail?.trim().toLowerCase() || null;
  const paymentLabel = PAYMENT_LABELS[input.paymentMethod];
  const actorReference = `user:${staffId}`;

  return db.transaction(async (tx) => {
    let buyerId: string;
    if (buyerEmail) {
      const [registered] = await tx.select({ id: users.id }).from(authUsers)
        .innerJoin(users, and(eq(users.identityIssuer, authIssuer), eq(users.identitySubject, authUsers.id)))
        .where(eq(authUsers.email, buyerEmail));
      if (!registered) {
        throw new OrderError('not_found', 'Buyer account not found');
      }
      buyerId = registered.id;
    } else {
      await tx.insert(users).values({ identityIssuer: WALK_IN_ISSUER, identitySubject: WALK_IN_SUBJECT })
        .onConflictDoNothing({ target: [users.identityIssuer, users.identitySubject] });
      const [walkIn] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.identityIssuer, WALK_IN_ISSUER), eq(users.identitySubject, WALK_IN_SUBJECT)));
      if (!walkIn) throw new Error('Walk-in buyer identity was not provisioned');
      buyerId = walkIn.id;
    }

    const retryKey = `order:${buyerId}:${idempotencyKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${retryKey}, 0))`);
    const [previous] = await tx.select().from(orders)
      .where(and(eq(orders.buyerId, buyerId), eq(orders.idempotencyKey, idempotencyKey)));
    if (previous) {
      const previousItems = await tx.select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, previous.id)).orderBy(orderItems.productId);
      if (!isDeepStrictEqual(previousItems, normalizedItems) || previous.fulfillmentMethod !== 'pickup') {
        throw new OrderError('conflict', 'Order key has already been used with different purchase details');
      }
      return { order: previous, buyerEmail };
    }

    const productIds = normalizedItems.map((item) => item.productId);
    const balances = await lockBalances(tx, and(
      inArray(inventoryBalances.productId, productIds),
      inArray(inventoryBalances.locationId, locationIds),
    ));
    const catalog = await tx.select().from(products).where(inArray(products.id, productIds))
      .orderBy(products.id).for('share');
    const catalogById = new Map(catalog.map((product) => [product.id, product]));

    const lines = normalizedItems.map(({ productId, quantity }) => {
      const product = catalogById.get(productId);
      if (!product || product.priceClp === null || product.saleCondition === null) {
        throw new OrderError('unavailable_product', 'A product lacks price or sale condition');
      }
      return {
        productId,
        quantity,
        productCodeSnapshot: product.code,
        productNameSnapshot: product.name,
        quantityUnitSnapshot: product.quantityUnit,
        unitPriceClp: product.priceClp,
        saleConditionSnapshot: product.saleCondition,
      };
    });

    const subtotalClp = lines.reduce((sum, line) => sum + BigInt(line.unitPriceClp) * BigInt(line.quantity), 0n);
    if (subtotalClp > maxClp) {
      throw new OrderError('invalid_input', 'Order total exceeds its integer range');
    }

    const balancesById = new Map(balances.map((balance) => [balance.id, balance]));
    const balanceIds = balances.map((balance) => balance.id);
    const eligible = balanceIds.length === 0
      ? []
      : await tx.select({ id: inventoryBalances.id, expiresOn: inventoryLots.expiresOn })
          .from(inventoryBalances)
          .innerJoin(products, eq(products.id, inventoryBalances.productId))
          .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
          .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
          .where(and(inArray(inventoryBalances.id, balanceIds), eligibleInventory()))
          .orderBy(sql`${inventoryLots.expiresOn} ASC NULLS LAST`, inventoryBalances.id)
          .for('share', { of: [products, inventoryLocations] });

    const byProduct = new Map<string, typeof balances>();
    for (const { id } of eligible) {
      const balance = balancesById.get(id);
      if (!balance || balance.onHandQuantity === balance.reservedQuantity) continue;
      const productBalances = byProduct.get(balance.productId) ?? [];
      productBalances.push(balance);
      byProduct.set(balance.productId, productBalances);
    }

    const allocations: { productId: string; balanceId: string; quantity: number }[] = [];
    for (const line of lines) {
      let remaining = line.quantity;
      for (const balance of byProduct.get(line.productId) ?? []) {
        const quantity = Math.min(remaining, balance.onHandQuantity - balance.reservedQuantity);
        allocations.push({ productId: line.productId, balanceId: balance.id, quantity });
        remaining -= quantity;
        if (remaining === 0) break;
      }
      if (remaining > 0) throw new OrderError('insufficient_stock', 'Insufficient eligible inventory');
    }

    // Serialize movement operation ID with inventory service lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`);
    const [existingMovement] = await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)
      .where(eq(inventoryMovements.operationId, idempotencyKey)).limit(1);
    if (existingMovement) {
      throw new OrderError('conflict', 'Operation ID has already been used for stock movements');
    }

    // 1. Create pending_payment order + items + active allocations (required by DB lifecycle guards).
    const [createdOrder] = await tx.insert(orders).values({
      buyerId,
      idempotencyKey,
      fulfillmentMethod: 'pickup',
      deliveryDetailsSnapshot: null,
      subtotalClp,
      deliveryFeeClp: 0,
      reservationExpiresAt: sql`clock_timestamp() + make_interval(secs => 60)`,
    }).returning();
    if (!createdOrder) throw new Error('In-person order insert did not return a row');

    const insertedItems = await tx.insert(orderItems).values(lines.map((line) => ({
      ...line,
      orderId: createdOrder.id,
    }))).returning({ id: orderItems.id, productId: orderItems.productId });
    const itemIds = new Map(insertedItems.map((item) => [item.productId, item.id]));

    const insertedReservations = await tx.insert(stockReservations).values(allocations.map((allocation) => {
      const orderItemId = itemIds.get(allocation.productId);
      if (!orderItemId) throw new Error('Allocation has no order item');
      return { ...allocation, orderItemId };
    })).returning({ id: stockReservations.id, balanceId: stockReservations.balanceId, quantity: stockReservations.quantity });

    await tx.insert(orderStatusEvents).values({
      orderId: createdOrder.id,
      toStatus: 'pending_payment',
      operationId: idempotencyKey,
      reason: `Venta presencial registrada (${paymentLabel})`,
      actorReference,
    });

    // 2. Confirm payment immediately.
    await tx.update(orders).set({ status: 'confirmed', updatedAt: sql`clock_timestamp()` })
      .where(eq(orders.id, createdOrder.id));
    await tx.insert(orderStatusEvents).values({
      orderId: createdOrder.id,
      fromStatus: 'pending_payment',
      toStatus: 'confirmed',
      operationId: randomUUID(),
      reason: `Pago presencial confirmado (${paymentLabel})`,
      actorReference,
    });

    // 3. Fulfill order, record sale movements, deduct physical stock and close reservations as consumed.
    const [fulfilledOrder] = await tx.update(orders).set({ status: 'fulfilled', updatedAt: sql`clock_timestamp()` })
      .where(eq(orders.id, createdOrder.id)).returning();
    if (!fulfilledOrder) throw new Error('In-person order fulfillment did not return a row');

    const movements = await tx.insert(inventoryMovements).values(insertedReservations.map((reservation) => ({
      balanceId: reservation.balanceId,
      movementType: 'sale' as const,
      quantityDelta: -reservation.quantity,
      operationId: idempotencyKey,
      reason: `Venta presencial en farmacia (${paymentLabel})`,
      actorReference,
    }))).returning({ id: inventoryMovements.id, balanceId: inventoryMovements.balanceId });
    const movementByBalance = new Map(movements.map((m) => [m.balanceId, m.id]));

    for (const reservation of insertedReservations) {
      await tx.update(inventoryBalances).set({
        onHandQuantity: sql`${inventoryBalances.onHandQuantity} - ${reservation.quantity}`,
        updatedAt: sql`clock_timestamp()`,
      }).where(eq(inventoryBalances.id, reservation.balanceId));

      await tx.update(stockReservations).set({
        status: 'consumed',
        consumedMovementId: movementByBalance.get(reservation.balanceId) ?? null,
        closedAt: sql`clock_timestamp()`,
      }).where(eq(stockReservations.id, reservation.id));
    }

    await tx.insert(orderStatusEvents).values({
      orderId: createdOrder.id,
      fromStatus: 'confirmed',
      toStatus: 'fulfilled',
      operationId: randomUUID(),
      reason: `Venta presencial entregada en farmacia (${paymentLabel})`,
      actorReference,
    });

    return { order: fulfilledOrder, buyerEmail };
  });
}
