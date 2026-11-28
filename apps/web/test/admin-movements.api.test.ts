import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  AdminMovementsApiError,
  listAdminInventoryMovements,
} from '../src/features/admin/admin-movements.api.js';

afterEach(() => mock.restoreAll());

const sampleMovement = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-11-22T18:00:00.000Z',
  movementType: 'receipt' as const,
  quantityDelta: 15,
  reason: 'Reposición bodega',
  actorReference: 'user:22222222-2222-4222-8222-222222222222',
  actorEmail: 'manulorenzo2004@gmail.com',
  productCode: '10464',
  productName: 'ACIDO MEFENAMICO 500 MG',
  locationName: 'Farmacia Comunitaria Peñalolén',
  lotNumber: null,
};

test('listAdminInventoryMovements builds query params and validates response', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([sampleMovement]));
  const result = await listAdminInventoryMovements({ query: '10464', movementType: 'receipt' });

  assert.equal(
    fetchMock.mock.calls[0]?.arguments[0],
    '/api/admin/inventory-movements?q=10464&movementType=receipt',
  );
  assert.deepEqual(result, [sampleMovement]);
});

test('listAdminInventoryMovements rejects forbidden and malformed payloads', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'forbidden' }, { status: 403 }),
  );
  await assert.rejects(
    listAdminInventoryMovements(),
    (error: unknown) => error instanceof AdminMovementsApiError && error.status === 403,
  );

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json([{ ...sampleMovement, quantityDelta: 0 }]),
  );
  await assert.rejects(
    listAdminInventoryMovements(),
    (error: unknown) => error instanceof AdminMovementsApiError && error.code === 'invalid_response',
  );
});
