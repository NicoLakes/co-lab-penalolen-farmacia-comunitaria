import type { Database } from '@farmacia/database';
import { orderItems, orders } from '@farmacia/database/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role } from '../auth/access.js';
import { createOrder } from './create-order.js';
import { maxInteger, OrderError } from './order-input.js';
import type { CreateOrderInput, OrderPolicy } from './order-input.js';
import { cancelPendingOrder, fulfillOrder } from './order-lifecycle.js';

export const uuidField = { type: 'string', format: 'uuid' } as const;
export type Authorize = (request: FastifyRequest, reply: FastifyReply, permission?: Permission) =>
  Promise<{ id: string; email: string; roles: Role[] } | undefined>;

const orderParams = {
  type: 'object', required: ['orderId'], properties: { orderId: uuidField },
};
const operationBody = {
  type: 'object', additionalProperties: false, required: ['operationId'], properties: { operationId: uuidField },
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

  for (const staff of [false, true]) {
    const base = staff ? '/api/fulfillment/orders' : '/api/orders';
    const permission = staff ? 'orders.read_for_fulfillment' : 'orders.read_own';
    const scope = (userId: string) => staff ? eq(orders.status, 'confirmed') : eq(orders.buyerId, userId);
    app.get(base, async (request, reply) => {
      const user = await authorize(request, reply, permission);
      if (!user) return reply;
      const rows = await db.select(summaryFields).from(orders).where(scope(user.id))
        .orderBy(desc(orders.createdAt), desc(orders.id)).limit(50);
      return rows.map(summary);
    });
    app.get<{ Params: { orderId: string } }>(`${base}/:orderId`, { schema: { params: orderParams } }, async (request, reply) => {
      const user = await authorize(request, reply, permission);
      if (!user) return reply;
      const [order] = await db.select().from(orders).where(and(eq(orders.id, request.params.orderId), scope(user.id)));
      if (!order) return reply.code(404).send({ code: 'not_found' });
      const items = await db.select({
        productId: orderItems.productId, name: orderItems.productNameSnapshot,
        quantity: orderItems.quantity, quantityUnit: orderItems.quantityUnitSnapshot,
        unitPriceClp: orderItems.unitPriceClp,
      }).from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(orderItems.productId);
      return { ...summary(order), deliveryDetails: order.deliveryDetailsSnapshot, items };
    });
  }

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
