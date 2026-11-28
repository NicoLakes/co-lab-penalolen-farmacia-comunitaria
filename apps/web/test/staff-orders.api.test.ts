import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  approveStaffPrescription,
  createInPersonOrder,
  fulfillStaffOrder,
  getFulfillmentOrderDetail,
  listFulfillmentOrders,
  rejectStaffPrescription,
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

const samplePrescription = {
  id: '66666666-6666-4666-8666-666666666666',
  fileName: 'receta.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 8192,
  status: 'pending' as const,
  reviewedAt: null,
  rejectionReason: null,
  createdAt: '2026-11-22T03:45:00.000Z',
};

test('listFulfillmentOrders queries by status including pending_review with null deadline', async () => {
  const pendingReview = { ...sampleOrder, status: 'pending_review' as const, reservationExpiresAt: null };
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([pendingReview]));
  const result = await listFulfillmentOrders('pending_review');
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/fulfillment/orders?status=pending_review');
  assert.deepEqual(result, [pendingReview]);
});

test('getFulfillmentOrderDetail returns validated items, delivery details and prescription', async () => {
  const detailPayload = {
    ...sampleOrder,
    status: 'pending_review' as const,
    reservationExpiresAt: null,
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
    prescription: samplePrescription,
  };
  mock.method(globalThis, 'fetch', async () => Response.json(detailPayload));
  const detail = await getFulfillmentOrderDetail(sampleOrder.id);
  assert.deepEqual(detail, detailPayload);
});

test('approveStaffPrescription and rejectStaffPrescription post review transitions', async () => {
  const approveOp = '88888888-8888-4888-8888-888888888888';
  const approveMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({
      ...sampleOrder,
      status: 'pending_payment',
      prescription: { ...samplePrescription, status: 'approved', reviewedAt: '2026-11-22T05:00:00.000Z' },
      notificationSent: true,
    }),
  );
  const approved = await approveStaffPrescription(sampleOrder.id, approveOp);
  assert.equal(approveMock.mock.calls[0]?.arguments[0], `/api/fulfillment/orders/${sampleOrder.id}/approve-prescription`);
  assert.equal(approved.status, 'pending_payment');
  assert.equal(approved.notificationSent, true);

  mock.restoreAll();
  const rejectOp = '99999999-9999-4999-8999-999999999999';
  const rejectMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({
      ...sampleOrder,
      status: 'rejected',
      reservationExpiresAt: null,
      prescription: {
        ...samplePrescription,
        status: 'rejected',
        reviewedAt: '2026-11-22T05:05:00.000Z',
        rejectionReason: 'Receta vencida',
      },
      notificationSent: true,
    }),
  );
  const rejected = await rejectStaffPrescription(sampleOrder.id, rejectOp, 'Receta vencida');
  assert.equal(rejectMock.mock.calls[0]?.arguments[0], `/api/fulfillment/orders/${sampleOrder.id}/reject-prescription`);
  assert.equal(rejectMock.mock.calls[0]?.arguments[1]?.body, JSON.stringify({ operationId: rejectOp, reason: 'Receta vencida' }));
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.prescription.rejectionReason, 'Receta vencida');
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
