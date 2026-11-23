import { isDeepStrictEqual } from 'node:util';
import type { Database } from '@farmacia/database';
import {
  authUsers,
  inventoryBalances,
  orderItems,
  orderPrescriptions,
  orders,
  orderStatusEvents,
  products,
  stockReservations,
  users,
} from '@farmacia/database/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { authIssuer } from '../auth/auth.js';
import {
  defaultPrescriptionPaymentSeconds,
  maxClp,
  maxInteger,
  normalizeOrderInput,
  OrderError,
  orderUuid,
  requiredText,
} from './order-input.js';
import type { CreateOrderInput, OrderPolicy } from './order-input.js';
import { releaseOrderReservations } from './order-lifecycle.js';
import {
  findEligibleBalances,
  lockBalances,
  onlineOrderSaleConditions,
  prescriptionSaleConditions,
} from './order-stock.js';
import {
  createPrescriptionStorageKey,
  validatePrescriptionFile,
} from './prescription-storage.js';
import type { PrescriptionFileInput, PrescriptionStorage } from './prescription-storage.js';

export type OrderPrescriptionRow = typeof orderPrescriptions.$inferSelect;

export interface PrescriptionSummary {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

export function serializePrescription(row: OrderPrescriptionRow): PrescriptionSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    status: row.status,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
  };
}

async function resolveBuyerEmail(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  buyerId: string,
): Promise<string | null> {
  const [row] = await tx.select({ email: authUsers.email }).from(users)
    .leftJoin(authUsers, and(eq(users.identityIssuer, authIssuer), eq(authUsers.id, users.identitySubject)))
    .where(eq(users.id, buyerId));
  return row?.email ?? null;
}

export async function createPrescriptionOrder(
  db: Database,
  buyerId: string,
  input: CreateOrderInput,
  fileInput: PrescriptionFileInput,
  policy: OrderPolicy,
  storage: PrescriptionStorage,
) {
  const buyer = orderUuid(buyerId);
  const request = normalizeOrderInput(input, policy);
  const validatedFile = validatePrescriptionFile(fileInput);
  const storageKey = createPrescriptionStorageKey(validatedFile.extension);

  await storage.save(storageKey, validatedFile.data);
  let keepFile = false;

  try {
    const result = await db.transaction(async (tx) => {
      const retryKey = `order:${buyer}:${request.idempotencyKey}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${retryKey}, 0))`);
      const [previous] = await tx.select().from(orders)
        .where(and(eq(orders.buyerId, buyer), eq(orders.idempotencyKey, request.idempotencyKey)));
      if (previous) {
        const items = await tx.select({ productId: orderItems.productId, quantity: orderItems.quantity })
          .from(orderItems).where(eq(orderItems.orderId, previous.id)).orderBy(orderItems.productId);
        const [previousPrescription] = await tx.select().from(orderPrescriptions)
          .where(eq(orderPrescriptions.orderId, previous.id));
        if (!previousPrescription
          || previousPrescription.fileSha256 !== validatedFile.fileSha256
          || !isDeepStrictEqual(items, request.items)
          || previous.fulfillmentMethod !== request.method
          || !isDeepStrictEqual(previous.deliveryDetailsSnapshot, request.deliveryDetails)) {
          throw new OrderError('conflict', 'Order key has already been used with different purchase details');
        }
        return { order: previous, prescription: previousPrescription, reused: true };
      }

      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, buyer)).for('key share');
      if (!user) throw new OrderError('not_found', 'Buyer not found');

      const productIds = request.items.map((item) => item.productId);
      const balances = await lockBalances(tx, and(
        inArray(inventoryBalances.productId, productIds),
        inArray(inventoryBalances.locationId, request.locationIds),
      ));
      const catalog = await tx.select().from(products).where(inArray(products.id, productIds))
        .orderBy(products.id).for('share');
      const catalogById = new Map(catalog.map((product) => [product.id, product]));

      let hasPrescriptionProduct = false;
      const lines = request.items.map(({ productId, quantity }) => {
        const product = catalogById.get(productId);
        const saleCondition = onlineOrderSaleConditions.find((condition) => condition === product?.saleCondition);
        if (!product?.isPublished || product.priceClp === null || !saleCondition) {
          throw new OrderError('unavailable_product', 'A product is unavailable for online prescription checkout');
        }
        if (prescriptionSaleConditions.some((condition) => condition === saleCondition)) {
          hasPrescriptionProduct = true;
        }
        return {
          productId,
          quantity,
          productCodeSnapshot: product.code,
          productNameSnapshot: product.name,
          quantityUnitSnapshot: product.quantityUnit,
          unitPriceClp: product.priceClp,
          saleConditionSnapshot: saleCondition,
        };
      });
      if (!hasPrescriptionProduct) {
        throw new OrderError('invalid_input', 'At least one item must require a prescription');
      }

      const subtotalClp = lines.reduce((sum, line) => sum + BigInt(line.unitPriceClp) * BigInt(line.quantity), 0n);
      if (subtotalClp + BigInt(request.deliveryFeeClp) > maxClp) {
        throw new OrderError('invalid_input', 'Order total exceeds its integer range');
      }

      const balancesById = new Map(balances.map((balance) => [balance.id, balance]));
      const eligible = await findEligibleBalances(tx, balances.map((balance) => balance.id), onlineOrderSaleConditions);
      const byProduct = new Map<string, typeof balances>();
      for (const { id } of eligible) {
        const balance = balancesById.get(id);
        if (!balance || balance.onHandQuantity === balance.reservedQuantity) continue;
        const productBalances = byProduct.get(balance.productId) ?? [];
        productBalances.push(balance);
        byProduct.set(balance.productId, productBalances);
      }

      const allocations: { productId: string; balanceId: string; quantity: number }[] = [];
      const insufficientProducts: string[] = [];
      for (const line of lines) {
        let remaining = line.quantity;
        for (const balance of byProduct.get(line.productId) ?? []) {
          const quantity = Math.min(remaining, balance.onHandQuantity - balance.reservedQuantity);
          allocations.push({ productId: line.productId, balanceId: balance.id, quantity });
          remaining -= quantity;
          if (remaining === 0) break;
        }
        if (remaining > 0) insufficientProducts.push(line.productNameSnapshot);
      }
      if (insufficientProducts.length > 0) {
        throw new OrderError('insufficient_stock', 'Insufficient eligible inventory', insufficientProducts);
      }

      const [order] = await tx.insert(orders).values({
        buyerId: buyer,
        status: 'pending_review',
        idempotencyKey: request.idempotencyKey,
        fulfillmentMethod: request.method,
        deliveryDetailsSnapshot: request.deliveryDetails,
        subtotalClp,
        deliveryFeeClp: request.deliveryFeeClp,
        reservationExpiresAt: null,
      }).returning();
      if (!order) throw new Error('Prescription order insert did not return a row');

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

      const [prescription] = await tx.insert(orderPrescriptions).values({
        orderId: order.id,
        uploadedByUserId: buyer,
        storageKey,
        fileName: validatedFile.fileName,
        mimeType: validatedFile.mimeType,
        fileSizeBytes: validatedFile.fileSizeBytes,
        fileSha256: validatedFile.fileSha256,
        status: 'pending',
      }).returning();
      if (!prescription) throw new Error('Prescription insert did not return a row');

      await tx.insert(orderStatusEvents).values({
        orderId: order.id,
        toStatus: 'pending_review',
        operationId: request.idempotencyKey,
        reason: 'Prescription order submitted and stock allocated for review',
        actorReference: `buyer:${buyer}`,
      });

      return { order, prescription, reused: false };
    });

    keepFile = !result.reused;
    return { order: result.order, prescription: result.prescription };
  } finally {
    if (!keepFile) {
      await storage.remove(storageKey).catch(() => undefined);
    }
  }
}

export async function approvePrescriptionOrder(
  db: Database,
  orderId: string,
  operation: { operationId: string; reviewerUserId: string; actorReference: string },
  policy?: Pick<OrderPolicy, 'prescriptionPaymentSeconds'>,
) {
  const id = orderUuid(orderId);
  const operationId = orderUuid(operation.operationId);
  const reviewerUserId = orderUuid(operation.reviewerUserId);
  const actorReference = requiredText(operation.actorReference);
  const paymentWindowSeconds = policy?.prescriptionPaymentSeconds ?? defaultPrescriptionPaymentSeconds;
  if (!Number.isInteger(paymentWindowSeconds) || paymentWindowSeconds <= 0 || paymentWindowSeconds > maxInteger) {
    throw new OrderError('invalid_input', 'Prescription payment window must be a positive integer');
  }

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw new OrderError('not_found', 'Order not found');

    const [previous] = await tx.select().from(orderStatusEvents)
      .where(and(eq(orderStatusEvents.orderId, id), eq(orderStatusEvents.operationId, operationId)));
    if (previous) {
      if (previous.toStatus !== 'pending_payment' || previous.actorReference !== actorReference) {
        throw new OrderError('conflict', 'Operation ID has already been used for another order transition');
      }
      const [prescription] = await tx.select().from(orderPrescriptions).where(eq(orderPrescriptions.orderId, id));
      if (!prescription) throw new Error('Approved prescription order has no prescription record');
      return { order, prescription, buyerEmail: await resolveBuyerEmail(tx, order.buyerId), alreadyProcessed: true };
    }

    if (order.status !== 'pending_review') {
      throw new OrderError('conflict', 'Only pending_review orders can be approved');
    }

    const [updatedOrder] = await tx.update(orders).set({
      status: 'pending_payment',
      reservationExpiresAt: sql`clock_timestamp() + make_interval(secs => ${paymentWindowSeconds})`,
      updatedAt: sql`clock_timestamp()`,
    }).where(eq(orders.id, id)).returning();
    if (!updatedOrder) throw new Error('Order approval update did not return a row');

    const [updatedPrescription] = await tx.update(orderPrescriptions).set({
      status: 'approved',
      reviewedByUserId: reviewerUserId,
      reviewedAt: sql`clock_timestamp()`,
      rejectionReason: null,
    }).where(eq(orderPrescriptions.orderId, id)).returning();
    if (!updatedPrescription) throw new OrderError('conflict', 'Order has no prescription attachment');

    await tx.insert(orderStatusEvents).values({
      orderId: id,
      fromStatus: 'pending_review',
      toStatus: 'pending_payment',
      reason: 'Prescription approved by pharmacist',
      operationId,
      actorReference,
    });

    const buyerEmail = await resolveBuyerEmail(tx, order.buyerId);
    return { order: updatedOrder, prescription: updatedPrescription, buyerEmail, alreadyProcessed: false };
  });
}

export async function rejectPrescriptionOrder(
  db: Database,
  orderId: string,
  operation: { operationId: string; reviewerUserId: string; actorReference: string; reason: string },
) {
  const id = orderUuid(orderId);
  const operationId = orderUuid(operation.operationId);
  const reviewerUserId = orderUuid(operation.reviewerUserId);
  const actorReference = requiredText(operation.actorReference);
  const rejectionReason = requiredText(operation.reason);
  if (rejectionReason.length > 500) {
    throw new OrderError('invalid_input', 'Rejection reason cannot exceed 500 characters');
  }

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw new OrderError('not_found', 'Order not found');

    const [previous] = await tx.select().from(orderStatusEvents)
      .where(and(eq(orderStatusEvents.orderId, id), eq(orderStatusEvents.operationId, operationId)));
    if (previous) {
      const [prescription] = await tx.select().from(orderPrescriptions).where(eq(orderPrescriptions.orderId, id));
      if (previous.toStatus !== 'rejected' || previous.actorReference !== actorReference
        || !prescription || prescription.rejectionReason !== rejectionReason) {
        throw new OrderError('conflict', 'Operation ID has already been used for another order transition');
      }
      return { order, prescription, buyerEmail: await resolveBuyerEmail(tx, order.buyerId), alreadyProcessed: true };
    }

    if (order.status !== 'pending_review') {
      throw new OrderError('conflict', 'Only pending_review orders can be rejected');
    }

    const [updatedOrder] = await tx.update(orders).set({
      status: 'rejected',
      updatedAt: sql`clock_timestamp()`,
    }).where(eq(orders.id, id)).returning();
    if (!updatedOrder) throw new Error('Order rejection update did not return a row');

    const [updatedPrescription] = await tx.update(orderPrescriptions).set({
      status: 'rejected',
      reviewedByUserId: reviewerUserId,
      reviewedAt: sql`clock_timestamp()`,
      rejectionReason,
    }).where(eq(orderPrescriptions.orderId, id)).returning();
    if (!updatedPrescription) throw new OrderError('conflict', 'Order has no prescription attachment');

    await releaseOrderReservations(tx, id);

    await tx.insert(orderStatusEvents).values({
      orderId: id,
      fromStatus: 'pending_review',
      toStatus: 'rejected',
      reason: 'Prescription rejected by pharmacist',
      operationId,
      actorReference,
    });

    const buyerEmail = await resolveBuyerEmail(tx, order.buyerId);
    return { order: updatedOrder, prescription: updatedPrescription, buyerEmail, alreadyProcessed: false };
  });
}
