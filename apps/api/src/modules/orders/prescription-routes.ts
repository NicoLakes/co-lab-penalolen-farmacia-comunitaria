import type { Database } from '@farmacia/database';
import { orderPrescriptions, orders } from '@farmacia/database/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CreateOrderInput, OrderPolicy } from './order-input.js';
import { maxInteger, OrderError } from './order-input.js';
import {
  buildPrescriptionApprovedEmail,
  buildPrescriptionRejectedEmail,
} from './order-notifications.js';
import type { SendOrderEmail } from './order-notifications.js';
import {
  approvePrescriptionOrder,
  createPrescriptionOrder,
  rejectPrescriptionOrder,
  serializePrescription,
} from './prescription-orders.js';
import { allowedPrescriptionMimeTypes } from './prescription-storage.js';
import type { PrescriptionStorage } from './prescription-storage.js';

const uuidField = { type: 'string', format: 'uuid' } as const;
const deliveryText = { type: 'string', minLength: 1, maxLength: 300 };

const orderParams = {
  type: 'object',
  required: ['orderId'],
  properties: { orderId: uuidField },
};

const approveBody = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId'],
  properties: { operationId: uuidField },
};

const rejectBody = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId', 'reason'],
  properties: {
    operationId: uuidField,
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
};

const createPrescriptionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['idempotencyKey', 'items', 'fulfillment', 'prescription'],
  properties: {
    idempotencyKey: uuidField,
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
    fulfillment: {
      oneOf: [
        { type: 'object', required: ['method'], properties: { method: { const: 'pickup' } } },
        {
          type: 'object',
          required: ['method', 'details'],
          properties: {
            method: { const: 'delivery' },
            details: {
              type: 'object',
              required: ['recipientName', 'phone', 'address', 'commune'],
              additionalProperties: false,
              properties: {
                recipientName: deliveryText,
                phone: deliveryText,
                address: deliveryText,
                commune: deliveryText,
              },
            },
          },
        },
      ],
    },
    prescription: {
      type: 'object',
      additionalProperties: false,
      required: ['fileName', 'mimeType', 'contentBase64'],
      properties: {
        fileName: { type: 'string', minLength: 1, maxLength: 255 },
        mimeType: { enum: [...allowedPrescriptionMimeTypes] },
        contentBase64: { type: 'string', minLength: 4, maxLength: 7_000_000 },
      },
    },
  },
};

type CreatePrescriptionOrderBody = CreateOrderInput & {
  prescription: {
    fileName: string;
    mimeType: string;
    contentBase64: string;
  };
};

interface PrescriptionRouteHelpers {
  authorize: (
    request: import('fastify').FastifyRequest,
    reply: FastifyReply,
    permission?: import('../auth/access.js').Permission,
  ) => Promise<{ id: string; email: string; roles: import('../auth/access.js').Role[] } | undefined>;
  sendOrderResult: (reply: FastifyReply, action: () => Promise<unknown>) => Promise<unknown>;
  summarizeOrder: (row: Pick<typeof orders.$inferSelect, 'id' | 'orderNumber' | 'status' | 'fulfillmentMethod' | 'totalClp' | 'reservationExpiresAt' | 'createdAt'>) => {
    id: string;
    orderNumber: string;
    status: typeof orders.$inferSelect['status'];
    fulfillmentMethod: typeof orders.$inferSelect['fulfillmentMethod'];
    totalClp: string;
    reservationExpiresAt: Date | null;
    createdAt: Date;
  };
  policy?: OrderPolicy | undefined;
  storage?: PrescriptionStorage | undefined;
  sendEmail?: SendOrderEmail | undefined;
  origin?: string | undefined;
}

function decodeBase64File(contentBase64: string): Buffer {
  const normalized = contentBase64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new OrderError('invalid_input', 'Prescription content must be valid base64');
  }
  return Buffer.from(normalized, 'base64');
}

function safeDownloadHeaderFilename(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').trim();
  return ascii || 'receta';
}

async function sendPrescriptionBinary(
  reply: FastifyReply,
  storage: PrescriptionStorage,
  prescription: typeof orderPrescriptions.$inferSelect,
) {
  const data = await storage.read(prescription.storageKey);
  if (!data) return reply.code(404).send({ code: 'not_found' });
  return reply
    .header('Content-Type', prescription.mimeType)
    .header('Content-Disposition', `inline; filename="${safeDownloadHeaderFilename(prescription.fileName)}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', 'sandbox')
    .header('Cache-Control', 'no-store')
    .send(data);
}

export function registerPrescriptionRoutes(
  app: FastifyInstance,
  db: Database,
  helpers: PrescriptionRouteHelpers,
) {
  const { authorize, sendOrderResult, summarizeOrder, policy, storage, sendEmail, origin } = helpers;

  app.post<{ Body: CreatePrescriptionOrderBody }>(
    '/api/orders/prescription',
    { bodyLimit: 8_388_608, schema: { body: createPrescriptionBody } },
    async (request, reply) => {
      const user = await authorize(request, reply, 'orders.create');
      if (!user) return reply;
      if (!policy || !storage) return reply.code(503).send({ code: 'checkout_unavailable' });

      return sendOrderResult(reply, async () => {
        const data = decodeBase64File(request.body.prescription.contentBase64);
        const { order, prescription } = await createPrescriptionOrder(
          db,
          user.id,
          {
            idempotencyKey: request.body.idempotencyKey,
            items: request.body.items,
            fulfillment: request.body.fulfillment,
          },
          {
            fileName: request.body.prescription.fileName,
            mimeType: request.body.prescription.mimeType,
            data,
          },
          policy,
          storage,
        );
        return reply.code(201).send({
          ...summarizeOrder(order),
          prescription: serializePrescription(prescription),
        });
      });
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/orders/:orderId/prescription',
    { schema: { params: orderParams } },
    async (request, reply) => {
      const user = await authorize(request, reply, 'orders.read_own');
      if (!user) return reply;
      if (!storage) return reply.code(503).send({ code: 'checkout_unavailable' });

      const [row] = await db.select({ prescription: orderPrescriptions }).from(orderPrescriptions)
        .innerJoin(orders, eq(orders.id, orderPrescriptions.orderId))
        .where(and(eq(orders.id, request.params.orderId), eq(orders.buyerId, user.id)));
      if (!row) return reply.code(404).send({ code: 'not_found' });
      return sendPrescriptionBinary(reply, storage, row.prescription);
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/api/fulfillment/orders/:orderId/prescription',
    { schema: { params: orderParams } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.read_for_fulfillment');
      if (!staff) return reply;
      if (!storage) return reply.code(503).send({ code: 'checkout_unavailable' });

      const [row] = await db.select({ prescription: orderPrescriptions }).from(orderPrescriptions)
        .innerJoin(orders, eq(orders.id, orderPrescriptions.orderId))
        .where(and(
          eq(orders.id, request.params.orderId),
          inArray(orders.status, ['pending_review', 'pending_payment', 'confirmed', 'fulfilled', 'rejected']),
        ));
      if (!row) return reply.code(404).send({ code: 'not_found' });
      return sendPrescriptionBinary(reply, storage, row.prescription);
    },
  );

  app.post<{ Params: { orderId: string }; Body: { operationId: string } }>(
    '/api/fulfillment/orders/:orderId/approve-prescription',
    { schema: { params: orderParams, body: approveBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.fulfill');
      if (!staff) return reply;

      return sendOrderResult(reply, async () => {
        const { order, prescription, buyerEmail, alreadyProcessed } = await approvePrescriptionOrder(
          db,
          request.params.orderId,
          {
            operationId: request.body.operationId,
            reviewerUserId: staff.id,
            actorReference: `user:${staff.id}`,
          },
          policy,
        );

        let notificationSent = false;
        if (!alreadyProcessed && buyerEmail && sendEmail && order.reservationExpiresAt) {
          try {
            await sendEmail(buildPrescriptionApprovedEmail({
              to: buyerEmail,
              orderNumber: order.orderNumber,
              totalClp: order.totalClp,
              reservationExpiresAt: order.reservationExpiresAt,
              origin: origin ?? '',
            }));
            notificationSent = true;
          } catch (error) {
            request.log.error({ err: error, orderId: order.id }, 'Failed to send prescription approval email');
          }
        }

        return {
          ...summarizeOrder(order),
          prescription: serializePrescription(prescription),
          notificationSent,
        };
      });
    },
  );

  app.post<{ Params: { orderId: string }; Body: { operationId: string; reason: string } }>(
    '/api/fulfillment/orders/:orderId/reject-prescription',
    { schema: { params: orderParams, body: rejectBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'orders.fulfill');
      if (!staff) return reply;

      return sendOrderResult(reply, async () => {
        const { order, prescription, buyerEmail, alreadyProcessed } = await rejectPrescriptionOrder(
          db,
          request.params.orderId,
          {
            operationId: request.body.operationId,
            reviewerUserId: staff.id,
            actorReference: `user:${staff.id}`,
            reason: request.body.reason,
          },
        );

        let notificationSent = false;
        if (!alreadyProcessed && buyerEmail && sendEmail && prescription.rejectionReason) {
          try {
            await sendEmail(buildPrescriptionRejectedEmail({
              to: buyerEmail,
              orderNumber: order.orderNumber,
              rejectionReason: prescription.rejectionReason,
              origin: origin ?? '',
            }));
            notificationSent = true;
          } catch (error) {
            request.log.error({ err: error, orderId: order.id }, 'Failed to send prescription rejection email');
          }
        }

        return {
          ...summarizeOrder(order),
          prescription: serializePrescription(prescription),
          notificationSent,
        };
      });
    },
  );
}
