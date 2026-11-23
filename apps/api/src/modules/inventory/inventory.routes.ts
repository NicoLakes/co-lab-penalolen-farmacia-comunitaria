import type { Database } from '@farmacia/database';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { maxInteger } from '../orders/order-input.js';
import type { OrderPolicy } from '../orders/order-input.js';
import { uuidField } from '../orders/order-routes.js';
import type { Authorize } from '../orders/order-routes.js';
import {
  adjustProductStock,
  createManagedProduct,
  deleteManagedProduct,
  listInventoryMovements,
  listManagedStock,
  movementTypes,
  saleConditions,
  StockManagementError,
  updateManagedProduct,
} from './stock-management.service.js';
import type {
  AdjustProductStockInput,
  CreateManagedProductInput,
  InventoryMovementType,
  UpdateManagedProductInput,
} from './stock-management.service.js';

const nullableShortText = { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] };
const nullableSaleCondition = { anyOf: [{ enum: [...saleConditions] }, { type: 'null' }] };
const nullablePrice = { anyOf: [{ type: 'integer', minimum: 1, maximum: maxInteger }, { type: 'null' }] };

const productParams = {
  type: 'object',
  required: ['productId'],
  properties: { productId: uuidField },
};

const createProductBody = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'quantityUnit', 'priceClp', 'saleCondition', 'isPublished', 'initialStock', 'operationId'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 300 },
    description: nullableShortText,
    quantityUnit: { type: 'string', minLength: 1, maxLength: 64 },
    activeIngredient: nullableShortText,
    dosageForm: nullableShortText,
    presentation: nullableShortText,
    supplierName: nullableShortText,
    therapeuticCategoryName: nullableShortText,
    priceClp: nullablePrice,
    saleCondition: nullableSaleCondition,
    isPublished: { type: 'boolean' },
    initialStock: { type: 'integer', minimum: 0, maximum: maxInteger },
    operationId: uuidField,
  },
};

const updateProductBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 300 },
    description: nullableShortText,
    activeIngredient: nullableShortText,
    dosageForm: nullableShortText,
    presentation: nullableShortText,
    supplierName: nullableShortText,
    therapeuticCategoryName: nullableShortText,
    priceClp: nullablePrice,
    saleCondition: nullableSaleCondition,
    isPublished: { type: 'boolean' },
  },
};

const adjustStockBody = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId', 'quantityDelta', 'reason'],
  properties: {
    operationId: uuidField,
    quantityDelta: { type: 'integer', minimum: -maxInteger, maximum: maxInteger },
    reason: { type: 'string', minLength: 1, maxLength: 300 },
    movementType: { enum: ['receipt', 'adjustment'] },
  },
};

async function sendStockResult(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof StockManagementError)) throw error;
    const status = error.code === 'not_found'
      ? 404
      : error.code === 'invalid_input'
        ? 400
        : error.code === 'no_active_location'
          ? 503
          : 409;
    return reply.code(status).send({ code: error.code });
  }
}

export function registerInventoryRoutes(
  app: FastifyInstance,
  db: Database,
  authorize: Authorize,
  policy?: OrderPolicy,
) {
  app.get<{ Querystring: { q?: string; movementType?: InventoryMovementType; limit?: number } }>(
    '/api/admin/inventory-movements',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 200 },
            movementType: { enum: [...movementTypes] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = await authorize(request, reply, 'inventory.read_audit');
      if (!admin) return reply;
      return listInventoryMovements(db, {
        query: request.query.q,
        movementType: request.query.movementType,
        limit: request.query.limit,
      });
    },
  );

  app.get('/api/staff/stock', async (request, reply) => {
    const staff = await authorize(request, reply, 'inventory.manage');
    if (!staff) return reply;
    return listManagedStock(db, policy?.locationIds);
  });

  app.post<{ Body: CreateManagedProductInput }>(
    '/api/staff/stock/products',
    { schema: { body: createProductBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'catalog.manage');
      if (!staff) return reply;
      return sendStockResult(reply, async () => {
        const created = await createManagedProduct(db, `user:${staff.id}`, request.body, policy?.locationIds);
        return reply.code(201).send(created);
      });
    },
  );

  app.patch<{ Params: { productId: string }; Body: UpdateManagedProductInput }>(
    '/api/staff/stock/products/:productId',
    { schema: { params: productParams, body: updateProductBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'catalog.manage');
      if (!staff) return reply;
      return sendStockResult(reply, () =>
        updateManagedProduct(db, request.params.productId.toLowerCase(), request.body, policy?.locationIds),
      );
    },
  );

  app.post<{ Params: { productId: string }; Body: AdjustProductStockInput }>(
    '/api/staff/stock/products/:productId/stock',
    { schema: { params: productParams, body: adjustStockBody } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'inventory.manage');
      if (!staff) return reply;
      return sendStockResult(reply, () =>
        adjustProductStock(
          db,
          `user:${staff.id}`,
          request.params.productId.toLowerCase(),
          request.body,
          policy?.locationIds,
        ),
      );
    },
  );

  app.delete<{ Params: { productId: string } }>(
    '/api/staff/stock/products/:productId',
    { schema: { params: productParams } },
    async (request, reply) => {
      const staff = await authorize(request, reply, 'catalog.manage');
      if (!staff) return reply;
      return sendStockResult(reply, async () => {
        await deleteManagedProduct(db, request.params.productId.toLowerCase());
        return reply.code(204).send();
      });
    },
  );
}
