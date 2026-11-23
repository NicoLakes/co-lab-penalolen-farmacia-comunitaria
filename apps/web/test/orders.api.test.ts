import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  cancelMyOrder,
  getMyOrderDetail,
  listMyOrders,
  OrdersApiError,
  payMyOrder,
} from '../src/features/orders/orders.api.js';

afterEach(() => mock.restoreAll());

const sampleSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'ORD-000001',
  status: 'pending_payment' as const,
  fulfillmentMethod: 'pickup' as const,
  totalClp: '1490',
  reservationExpiresAt: '2026-11-22T04:00:00.000Z',
  createdAt: '2026-11-22T03:45:00.000Z',
};

test('listMyOrders returns validated order summaries', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([sampleSummary]));
  const orders = await listMyOrders();

  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/orders');
  assert.deepEqual(orders, [sampleSummary]);
});

test('listMyOrders rejects unauthorized responses with OrdersApiError', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'authentication_required' }, { status: 401 }),
  );
  await assert.rejects(
    listMyOrders(),
    (error: unknown) =>
      error instanceof OrdersApiError && error.status === 401 && error.code === 'authentication_required',
  );
});

test('getMyOrderDetail validates items and delivery details', async () => {
  const sampleDetail = {
    ...sampleSummary,
    fulfillmentMethod: 'delivery' as const,
    deliveryDetails: {
      recipientName: 'Ana Pérez',
      phone: '+56912345678',
      address: 'Av. Grecia 1234',
      commune: 'Peñalolén',
    },
    items: [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        name: 'AC. ACETIL SALICILICO 100 MG',
        quantity: 2,
        quantityUnit: 'caja',
        unitPriceClp: 1490,
      },
    ],
  };
  mock.method(globalThis, 'fetch', async () => Response.json(sampleDetail));

  const detail = await getMyOrderDetail(sampleSummary.id);
  assert.deepEqual(detail, sampleDetail);
});

test('getMyOrderDetail rejects malformed payloads', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ ...sampleSummary, items: 'invalid' }));
  await assert.rejects(
    getMyOrderDetail(sampleSummary.id),
    (error: unknown) => error instanceof OrdersApiError && error.code === 'invalid_response',
  );
});

test('cancelMyOrder posts operationId and returns updated summary', async () => {
  const cancelled = { ...sampleSummary, status: 'cancelled' as const };
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(cancelled));
  const operationId = '33333333-3333-4333-8333-333333333333';

  const result = await cancelMyOrder(sampleSummary.id, operationId);
  const call = fetchMock.mock.calls[0];
  assert.equal(call?.arguments[0], `/api/orders/${sampleSummary.id}/cancel`);
  assert.equal(call?.arguments[1]?.method, 'POST');
  assert.equal(call?.arguments[1]?.body, JSON.stringify({ operationId }));
  assert.deepEqual(result, cancelled);
});

test('payMyOrder posts operationId and handles expired 409 errors', async () => {
  const confirmed = { ...sampleSummary, status: 'confirmed' as const };
  const operationId = '44444444-4444-4444-8444-444444444444';
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(confirmed));

  const result = await payMyOrder(sampleSummary.id, operationId);
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], `/api/orders/${sampleSummary.id}/pay`);
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.body, JSON.stringify({ operationId }));
  assert.equal(result.status, 'confirmed');

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'expired' }, { status: 409 }),
  );
  await assert.rejects(
    payMyOrder(sampleSummary.id, operationId),
    (error: unknown) =>
      error instanceof OrdersApiError && error.status === 409 && error.code === 'expired',
  );
});
