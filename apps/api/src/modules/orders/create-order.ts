import { isDeepStrictEqual } from 'node:util';
import type { Database } from '@farmacia/database';
import { inventoryBalances, orderItems, orders, orderStatusEvents, products, stockReservations, users } from '@farmacia/database/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { maxClp, normalizeOrderInput, OrderError, orderUuid } from './order-input.js';
import type { CreateOrderInput, OrderPolicy } from './order-input.js';
import { allowedSaleConditions, findEligibleBalances, lockBalances } from './order-stock.js';

// The buyer ID comes from the backend's authenticated identity mapping.
export async function createOrder(db: Database, buyerId: string, input: CreateOrderInput, policy: OrderPolicy) {
  const buyer = orderUuid(buyerId);
  const request = normalizeOrderInput(input, policy);
  const allowedConditions = allowedSaleConditions(request.prescriptionValidated);
  return db.transaction(async (tx) => {
    const retryKey = `order:${buyer}:${request.idempotencyKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${retryKey}, 0))`);
    const [previous] = await tx.select().from(orders)
      .where(and(eq(orders.buyerId, buyer), eq(orders.idempotencyKey, request.idempotencyKey)));
    if (previous) {
      const items = await tx.select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, previous.id)).orderBy(orderItems.productId);
      if (!isDeepStrictEqual(items, request.items) || previous.fulfillmentMethod !== request.method
        || !isDeepStrictEqual(previous.deliveryDetailsSnapshot, request.deliveryDetails)) {
        throw new OrderError('conflict', 'Order key has already been used with different purchase details');
      }
      return previous;
    }

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, buyer)).for('key share');
    if (!user) throw new OrderError('not_found', 'Buyer not found');

    const productIds = request.items.map((item) => item.productId);
    const balances = await lockBalances(tx, and(
      inArray(inventoryBalances.productId, productIds), inArray(inventoryBalances.locationId, request.locationIds),
    ));
    const catalog = await tx.select().from(products).where(inArray(products.id, productIds))
      .orderBy(products.id).for('share');
    const catalogById = new Map(catalog.map((product) => [product.id, product]));
    const lines = request.items.map(({ productId, quantity }) => {
      const product = catalogById.get(productId);
      const saleCondition = allowedConditions.find((condition) => condition === product?.saleCondition);
      if (!product?.isPublished || product.priceClp === null || !saleCondition) {
        throw new OrderError('unavailable_product', 'A product is unavailable for this purchase flow');
      }
      return {
        productId, quantity, productCodeSnapshot: product.code, productNameSnapshot: product.name,
        quantityUnitSnapshot: product.quantityUnit, unitPriceClp: product.priceClp,
        saleConditionSnapshot: saleCondition,
      };
    });
    const subtotalClp = lines.reduce((sum, line) => sum + BigInt(line.unitPriceClp) * BigInt(line.quantity), 0n);
    if (subtotalClp + BigInt(request.deliveryFeeClp) > maxClp) {
      throw new OrderError('invalid_input', 'Order total exceeds its integer range');
    }

    const balancesById = new Map(balances.map((balance) => [balance.id, balance]));
    const eligible = await findEligibleBalances(tx, balances.map((balance) => balance.id), request.prescriptionValidated);
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

    const [order] = await tx.insert(orders).values({
      buyerId: buyer, idempotencyKey: request.idempotencyKey, fulfillmentMethod: request.method,
      deliveryDetailsSnapshot: request.deliveryDetails, subtotalClp, deliveryFeeClp: request.deliveryFeeClp,
      reservationExpiresAt: sql`clock_timestamp() + make_interval(secs => ${request.reservationSeconds})`,
    }).returning();
    if (!order) throw new Error('Order insert did not return a row');
    const items = await tx.insert(orderItems).values(lines.map((line) => ({ ...line, orderId: order.id })))
      .returning({ id: orderItems.id, productId: orderItems.productId });
    const itemIds = new Map(items.map((item) => [item.productId, item.id]));
    await tx.insert(stockReservations).values(allocations.map((allocation) => {
      const orderItemId = itemIds.get(allocation.productId);
      if (!orderItemId) throw new Error('Allocation has no order item');
      return { ...allocation, orderItemId };
    }));
    for (const { balanceId, quantity } of allocations) {
      await tx.update(inventoryBalances).set({
        reservedQuantity: sql`${inventoryBalances.reservedQuantity} + ${quantity}`,
        updatedAt: sql`clock_timestamp()`,
      }).where(eq(inventoryBalances.id, balanceId));
    }
    await tx.insert(orderStatusEvents).values({
      orderId: order.id, toStatus: 'pending_payment', operationId: request.idempotencyKey,
      reason: 'Order created and stock allocated', actorReference: `buyer:${buyer}`,
    });
    return order;
  });
}
