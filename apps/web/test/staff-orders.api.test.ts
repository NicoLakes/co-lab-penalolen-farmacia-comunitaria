import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  fulfillStaffOrder,
  getFulfillmentOrderDetail,
  listFulfillmentOrders,
  StaffOrdersApiError,
} from '../src/features/management/staff-orders.api.js';

afterEach(() => mock.restoreAll());

const sampleOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'FC-1',
  status: 'confirmed' as const,
  fulfillmentMethod: 'pickup' as const,
  totalClp: '1980',
  reservationExpiresAt: '2026-11-22T04:00:00.000Z',
  createdAt: '2026-11-22T03:45:00.000Z',
  buyerEmail: 'vecino@penalolen.local',
};

test('listFulfillmentOrders queries by status and validates buyerEmail', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([sampleOrder]));
  const result = await listFulfillmentOrders('confirmed');
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/fulfillment/orders?status=confirmed');
  assert.deepEqual(result, [sampleOrder]);
});

test('getFulfillmentOrderDetail returns validated items and delivery details', async () => {
  const detailPayload = {
    ...sampleOrder,
    fulfillmentMethod: 'delivery' as const,
    deliveryDetails: {
      recipientName: 'Carlos Díaz',
      phone: '+56912345678',
      address: 'Av. Tobalaba 5000',
      commune: 'Peñalolén',
    },
    items: [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        name: 'ACIDO MEFENAMICO 500 MG',
        quantity: 2,
        quantityUnit: 'caja',
        unitPriceClp: 990,
      },
    ],
  };
  mock.method(globalThis, 'fetch', async () => Response.json(detailPayload));
  const detail = await getFulfillmentOrderDetail(sampleOrder.id);
  assert.deepEqual(detail, detailPayload);
});

test('fulfillStaffOrder posts operationId and surfaces 409 errors', async () => {
  const operationId = '33333333-3333-4333-8333-333333333333';
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...sampleOrder, status: 'fulfilled' }),
  );
  const updated = await fulfillStaffOrder(sampleOrder.id, operationId);
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], `/api/fulfillment/orders/${sampleOrder.id}/fulfill`);
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.body, JSON.stringify({ operationId }));
  assert.equal(updated.status, 'fulfilled');

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'unavailable_product' }, { status: 409 }),
  );
  await assert.rejects(
    fulfillStaffOrder(sampleOrder.id, operationId),
    (error: unknown) =>
      error instanceof StaffOrdersApiError
      && error.status === 409
      && error.code === 'unavailable_product',
  );
});

test('createInPersonOrder posts walk-in sale and handles insufficient_stock 409', async () => {
  const { createInPersonOrder } = await import('../src/features/management/staff-orders.api.js');
  const idempotencyKey = '55555555-5555-4555-8555-555555555555';
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...sampleOrder, status: 'fulfilled', buyerEmail: null }, { status: 201 }),
  );
  const created = await createInPersonOrder({
    idempotencyKey,
    buyerEmail: null,
    paymentMethod: 'bank_transfer',
    items: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
  });
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/fulfillment/orders/in-person');
  assert.equal(created.status, 'fulfilled');

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'insufficient_stock' }, { status: 409 }),
  );
  await assert.rejects(
    createInPersonOrder({
      idempotencyKey,
      buyerEmail: null,
      paymentMethod: 'cash',
      items: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 99 }],
    }),
    (error: unknown) =>
      error instanceof StaffOrdersApiError
      && error.status === 409
      && error.code === 'insufficient_stock',
  );
});
