import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  adjustStaffProductStock,
  createStaffProduct,
  deleteStaffProduct,
  listStaffStock,
  StaffStockApiError,
  updateStaffProduct,
} from '../src/features/management/staff-stock.api.js';

afterEach(() => mock.restoreAll());

const sampleItem = {
  id: '11111111-1111-4111-8111-111111111111',
  code: '10464',
  name: 'ACIDO MEFENAMICO 500 MG',
  description: 'Caja 10 comprimidos',
  quantityUnit: 'caja',
  activeIngredient: 'ACIDO MEFENAMICO 500 MG',
  dosageForm: 'COMPRIMIDO',
  presentation: '10 comprimidos',
  supplier: 'CARIBEAN',
  therapeuticCategory: 'ANALGESICO',
  priceClp: 990,
  saleCondition: 'direct_sale' as const,
  isPublished: true,
  inventoryTracking: 'quantity_only' as const,
  onHandQuantity: 30,
  reservedQuantity: 2,
  availableQuantity: 28,
};

test('listStaffStock validates staff stock response', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json([sampleItem]));
  const items = await listStaffStock();
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/staff/stock');
  assert.deepEqual(items, [sampleItem]);
});

test('createStaffProduct posts payload and handles duplicate_code 409', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(sampleItem, { status: 201 }));
  const created = await createStaffProduct({
    code: '10464',
    name: 'ACIDO MEFENAMICO 500 MG',
    description: null,
    quantityUnit: 'caja',
    activeIngredient: null,
    dosageForm: null,
    presentation: null,
    supplierName: null,
    therapeuticCategoryName: null,
    priceClp: 990,
    saleCondition: 'direct_sale',
    isPublished: true,
    initialStock: 10,
    operationId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(created.code, '10464');

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'duplicate_code' }, { status: 409 }),
  );
  await assert.rejects(
    createStaffProduct({
      code: '10464',
      name: 'Duplicado',
      description: null,
      quantityUnit: 'caja',
      activeIngredient: null,
      dosageForm: null,
      presentation: null,
      supplierName: null,
      therapeuticCategoryName: null,
      priceClp: 990,
      saleCondition: 'direct_sale',
      isPublished: true,
      initialStock: 0,
      operationId: '22222222-2222-4222-8222-222222222222',
    }),
    (error: unknown) =>
      error instanceof StaffStockApiError && error.status === 409 && error.code === 'duplicate_code',
  );
});

test('updateStaffProduct sends PATCH and adjustStaffProductStock sends POST', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...sampleItem, isPublished: false }),
  );
  const updated = await updateStaffProduct(sampleItem.id, { isPublished: false });
  assert.equal(updated.isPublished, false);
  assert.equal(fetchMock.mock.calls[0]?.arguments[1]?.method, 'PATCH');

  mock.restoreAll();
  const adjustMock = mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...sampleItem, onHandQuantity: 35, availableQuantity: 33 }),
  );
  const adjusted = await adjustStaffProductStock(sampleItem.id, {
    operationId: '33333333-3333-4333-8333-333333333333',
    quantityDelta: 5,
    reason: 'Reposición',
    movementType: 'receipt',
  });
  assert.equal(adjusted.onHandQuantity, 35);
  assert.equal(adjustMock.mock.calls[0]?.arguments[0], `/api/staff/stock/products/${sampleItem.id}/stock`);
});

test('deleteStaffProduct surfaces product_has_history 409 cleanly', async () => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'product_has_history' }, { status: 409 }),
  );
  await assert.rejects(
    deleteStaffProduct(sampleItem.id),
    (error: unknown) =>
      error instanceof StaffStockApiError
      && error.status === 409
      && error.code === 'product_has_history',
  );
});
