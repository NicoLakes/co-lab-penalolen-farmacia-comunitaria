import type { Database } from '@farmacia/database';
import { authUsers, orderItems, orders, users } from '@farmacia/database/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role } from '../auth/access.js';
import { authIssuer } from '../auth/auth.js';
import { createOrder } from './create-order.js';
import { createInPersonOrder, inPersonPaymentMethods } from './in-person-order.js';
import type { CreateInPersonOrderInput } from './in-person-order.js';
import { maxInteger, OrderError } from './order-input.js';
import type { CreateOrderInput, OrderPolicy } from './order-input.js';
import { cancelPendingOrder, confirmOrderPayment, fulfillOrder } from './order-lifecycle.js';

export const uuidField = { type: 'string', format: 'uuid' } as const;
export type Authorize = (request: FastifyRequest, reply: FastifyReply, permission?: Permission) =>
  Promise<{ id: string; email: string; roles: Role[] } | undefined>;

const orderParams = {
  type: 'object', required: ['orderId'], properties: { orderId: uuidField },
};
const operationBody = {
  type: 'object', additionalProperties: false, required: ['operationId'], properties: { operationId: uuidField },
};
const fulfillmentListQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { enum: ['confirmed', 'fulfilled'] },
  },
};
const createInPersonBody = {
  type: 'object',
  additionalProperties: false,
  required: ['idempotencyKey', 'paymentMethod', 'items'],
  properties: {
    idempotencyKey: uuidField,
    buyerEmail: { anyOf: [{ type: 'string', format: 'email', maxLength: 254 }, { type: 'null' }] },
    paymentMethod: { enum: [...inPersonPaymentMethods] },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['productId', 'quantity'],
        properties: {
          productId: uuidField,
          quantity: { type: 'integer', minimum: 1, maximum: maxInteger },
        },
      },
    },
  },
};
const deliveryText = { type: 'string', minLength: 1, maxLength: 300 };
const createBody = {
  type: 'object', additionalProperties: false, required: ['idempotencyKey', 'items', 'fulfillment'],
  properties: {
    idempotencyKey: uuidField,
    items: {
      type: 'array', minItems: 1, maxItems: 100,
      items: {
        type: 'object', additionalProperties: false, required: ['productId', 'quantity'],
        properties: { productId: uuidField, quantity: { type: 'integer', minimum: 1, maximum: maxInteger } },
      },
    },
    fulfillment: {
      oneOf: [
        { type: 'object', required: ['method'], properties: { method: { const: 'pickup' } } },
        {
          type: 'object', required: ['method', 'details'], properties: {
            method: { const: 'delivery' },
            details: {
              type: 'object', required: ['recipientName', 'phone', 'address', 'commune'], additionalProperties: false,
              properties: { recipientName: deliveryText, phone: deliveryText, address: deliveryText, commune: deliveryText },
            },
          },
        },
      ],
    },
  },
};

const summaryFields = {
  id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
  fulfillmentMethod: orders.fulfillmentMethod, totalClp: orders.totalClp,
  reservationExpiresAt: orders.reservationExpiresAt, createdAt: orders.createdAt,
};

function summary(row: Pick<typeof orders.$inferSelect, keyof typeof summaryFields>) {
  const { id, orderNumber, status, fulfillmentMethod, totalClp, reservationExpiresAt, createdAt } = row;
  return { id, orderNumber, status, fulfillmentMethod, totalClp: totalClp.toString(), reservationExpiresAt, createdAt };
}

async function loadOrderItems(db: Database, orderId: string) {
  return db.select({
    productId: orderItems.productId, name: orderItems.productNameSnapshot,
    quantity: orderItems.quantity, quantityUnit: orderItems.quantityUnitSnapshot,
    unitPriceClp: orderItems.unitPriceClp,
  }).from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.productId);
}

async function sendOrderResult(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof OrderError)) throw error;
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid_input' ? 400 : 409;
    return reply.code(status).send({ code: error.code });
  }
}

export function registerOrderRoutes(app: FastifyInstance, db: Database, authorize: Authorize, policy?: OrderPolicy) {
  app.post<{ Body: CreateOrderInput }>('/api/orders', { schema: { body: createBody } }, async (request, reply) => {
    const user = await authorize(request, reply, 'orders.create');
    if (!user) return reply;
    if (!policy) return reply.code(503).send({ code: 'checkout_unavailable' });
    return sendOrderResult(reply, async () => summary(await createOrder(db, user.id, request.body, policy)));
  });

  app.get('/api/orders', async (request, reply) => {
    const user = await authorize(request, reply, 'orders.read_own');
    if (!user) return reply;
    const rows = await db.select(summaryFields).from(orders).where(eq(orders.buyerId, user.id))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(50);
    return rows.map(summary);
  });

  app.get<{ Params: { orderId: string } }>('/api/orders/:orderId', { schema: { params: orderParams } }, async (request, reply) => {
    const user = await authorize(request, reply, 'orders.read_own');
    if (!user) return reply;
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, request.params.orderId), eq(orders.buyerId, user.id)));
    if (!order) return reply.code(404).send({ code: 'not_found' });
    const items = await loadOrderItems(db, order.id);
    return { ...summary(order), deliveryDetails: order.deliveryDetailsSnapshot, items };
  });

  app.get<{ Querystring: { status?: 'confirmed' | 'fulfilled' } }>(
    '/api/fulfillment/orders',
    { schema: { querystring: fulfillmentListQuery } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.read_for_fulfillment');
      if (!staff) return reply;
      const targetStatus = request.query.status ?? 'confirmed';
      const rows = await db.select({ ...summaryFields, buyerEmail: authUsers.email }).from(orders)
        .leftJoin(users, eq(users.id, orders.buyerId))
        .leftJoin(authUsers, and(eq(users.identityIssuer, authIssuer), eq(authUsers.id, users.identitySubject)))
        .where(eq(orders.status, targetStatus))
        .orderBy(desc(orders.updatedAt), desc(orders.id))
        .limit(50);
      return rows.map((row) => ({ ...summary(row), buyerEmail: row.buyerEmail ?? null }));
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/fulfillment/orders/:orderId',
    { schema: { params: orderParams } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.read_for_fulfillment');
      if (!staff) return reply;
      const [row] = await db.select({ order: orders, buyerEmail: authUsers.email }).from(orders)
        .leftJoin(users, eq(users.id, orders.buyerId))
        .leftJoin(authUsers, and(eq(users.identityIssuer, authIssuer), eq(authUsers.id, users.identitySubject)))
        .where(and(eq(orders.id, request.params.orderId), inArray(orders.status, ['confirmed', 'fulfilled'])));
      if (!row) return reply.code(404).send({ code: 'not_found' });
      const items = await loadOrderItems(db, row.order.id);
      return {
        ...summary(row.order),
        buyerEmail: row.buyerEmail ?? null,
        deliveryDetails: row.order.deliveryDetailsSnapshot,
        items,
      };
    },
  );

  const transitionSchema = { schema: { params: orderParams, body: operationBody } };
  type Transition = { Params: { orderId: string }; Body: { operationId: string } };
  app.post<Transition>('/api/orders/:orderId/cancel', transitionSchema, async (request, reply) => {
    const user = await authorize(request, reply, 'orders.cancel_own');
    if (!user) return reply;
    return sendOrderResult(reply, async () => {
      const order = await cancelPendingOrder(db, request.params.orderId, user.id, request.body.operationId);
      if (!order) throw new Error('Cancellation did not return an order');
      return summary(order);
    });
  });
  // Temporary direct-confirmation boundary until Webpay Oneclick authorization replaces this step.
  app.post<Transition>('/api/orders/:orderId/pay', transitionSchema, async (request, reply) => {
    const user = await authorize(request, reply, 'orders.pay_own');
    if (!user) return reply;
    return sendOrderResult(reply, async () => {
      const [owned] = await db.select({ id: orders.id, totalClp: orders.totalClp }).from(orders)
        .where(and(eq(orders.id, request.params.orderId), eq(orders.buyerId, user.id)));
      if (!owned) throw new OrderError('not_found', 'Order not found');
      const order = await confirmOrderPayment(db, owned.id, owned.totalClp, {
        operationId: request.body.operationId,
        actorReference: `buyer:${user.id}`,
      });
      if (!order) throw new Error('Payment confirmation did not return an order');
      return summary(order);
    });
  });
  app.post<{ Body: CreateInPersonOrderInput }>(
    '/api/fulfillment/orders/in-person',
    { schema: { body: createInPersonBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.fulfill');
      if (!staff) return reply;
      if (!policy) return reply.code(503).send({ code: 'checkout_unavailable' });
      return sendOrderResult(reply, async () => {
        const { order, buyerEmail } = await createInPersonOrder(db, staff.id, request.body, policy);
        return reply.code(201).send({ ...summary(order), buyerEmail });
      });
    },
  );

  app.post<Transition>('/api/fulfillment/orders/:orderId/fulfill', transitionSchema, async (request, reply) => {
    const user = await authorize(request, reply, 'orders.fulfill');
    if (!user) return reply;
    return sendOrderResult(reply, async () => {
      const order = await fulfillOrder(db, request.params.orderId, {
        operationId: request.body.operationId, actorReference: `user:${user.id}`,
      });
      if (!order) throw new Error('Fulfillment did not return an order');
      return summary(order);
    });
  });
}
