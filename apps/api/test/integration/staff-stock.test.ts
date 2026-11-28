import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { inventoryLocations, inventoryMovements } from '@farmacia/database/schema';
import { buildApp } from '../../src/app.js';
import { setUserRole } from '../../src/modules/auth/access.js';
import { registerAccessRoutes } from '../../src/modules/auth/access-routes.js';
import { createAuth } from '../../src/modules/auth/auth.js';
import { registerCatalogRoutes } from '../../src/modules/catalog/catalog.routes.js';
import { isolatedDatabase } from './isolated-database.js';

test('staff stock endpoints enforce permissions, audit movements, visibility and safe deletion', async (t) => {
  const db = await isolatedDatabase(t);
  const origin = 'https://farmacia.example.test';
  const codes = new Map<string, string>();
  const [location] = await db.insert(inventoryLocations).values({
    code: 'CENTRAL',
    name: 'Farmacia Central',
  }).returning();
  assert.ok(location);

  const app = buildApp();
  t.after(() => app.close());
  const orderPolicy = { locationIds: [location.id], reservationSeconds: 300, deliveryFeeClp: 0 };
  registerCatalogRoutes(app, db, orderPolicy);
  registerAccessRoutes(app, {
    db,
    origin,
    auth: createAuth(db, {
      origin,
      secret: randomBytes(32).toString('hex'),
      sendCode: async (email, code) => { codes.set(email, code); },
    }),
    orderPolicy,
  });

  async function signIn(email: string, remoteAddress: string) {
    const sent = await app.inject({
      method: 'POST', url: '/api/auth/email-otp/send-verification-otp', headers: { origin }, remoteAddress,
      payload: { email, type: 'sign-in' },
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const code = codes.get(email);
    assert.ok(code);
    const verified = await app.inject({
      method: 'POST', url: '/api/auth/sign-in/email-otp', headers: { origin }, remoteAddress,
      payload: { email, otp: code },
    });
    assert.equal(verified.statusCode, 200, verified.body);
    const rawCookie = verified.headers['set-cookie'];
    assert.ok(rawCookie);
    const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
    const headers = { origin, cookie: cookieHeaders.map((value) => value.split(';', 1)[0]).join('; ') };
    const me = await app.inject({ method: 'GET', url: '/api/me', headers });
    assert.equal(me.statusCode, 200, me.body);
    return { id: me.json<{ id: string }>().id, headers };
  }

  const admin = await signIn('admin@example.test', '192.0.2.10');
  const staff = await signIn('staff@example.test', '192.0.2.11');
  const buyer = await signIn('buyer@example.test', '192.0.2.12');
  assert.equal(await setUserRole(db, admin.id, 'user_admin', true), 'ok');
  assert.equal(await setUserRole(db, staff.id, 'pharmacy_operator', true, admin.id), 'ok');
  assert.equal(await setUserRole(db, buyer.id, 'buyer', true, admin.id), 'ok');

  assert.equal((await app.inject({ method: 'GET', url: '/api/staff/stock', headers: buyer.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/staff/stock', headers: admin.headers })).statusCode, 403);

  const createdWithStock = await app.inject({
    method: 'POST',
    url: '/api/staff/stock/products',
    headers: staff.headers,
    payload: {
      code: 'MED-100',
      name: 'Paracetamol 500 mg',
      description: 'Caja 16 comprimidos',
      quantityUnit: 'caja',
      activeIngredient: 'Paracetamol',
      dosageForm: 'Comprimido',
      presentation: '16 comprimidos',
      supplierName: 'Laboratorio Prueba',
      therapeuticCategoryName: 'Analgésico',
      priceClp: 1200,
      saleCondition: 'direct_sale',
      isPublished: true,
      initialStock: 10,
      operationId: randomUUID(),
    },
  });
  assert.equal(createdWithStock.statusCode, 201, createdWithStock.body);
  const first = createdWithStock.json<{ id: string; onHandQuantity: number; availableQuantity: number; isPublished: boolean }>();
  assert.equal(first.onHandQuantity, 10);
  assert.equal(first.availableQuantity, 10);
  assert.equal(first.isPublished, true);

  const adjusted = await app.inject({
    method: 'POST',
    url: `/api/staff/stock/products/${first.id}/stock`,
    headers: staff.headers,
    payload: {
      operationId: randomUUID(),
      quantityDelta: -3,
      reason: 'Ajuste de conteo físico',
      movementType: 'adjustment',
    },
  });
  assert.equal(adjusted.statusCode, 200, adjusted.body);
  assert.equal(adjusted.json<{ onHandQuantity: number }>().onHandQuantity, 7);

  const movements = await db.select().from(inventoryMovements);
  assert.equal(movements.length, 2);

  const hidden = await app.inject({
    method: 'PATCH',
    url: `/api/staff/stock/products/${first.id}`,
    headers: staff.headers,
    payload: { isPublished: false, priceClp: 1350 },
  });
  assert.equal(hidden.statusCode, 200, hidden.body);
  assert.equal(hidden.json<{ isPublished: boolean; priceClp: number }>().isPublished, false);
  assert.equal(hidden.json<{ priceClp: number }>().priceClp, 1350);

  const publicCatalog = await app.inject({ method: 'GET', url: '/api/catalog' });
  assert.equal(publicCatalog.json<{ items: unknown[] }>().items.length, 0);

  const blockedDelete = await app.inject({
    method: 'DELETE',
    url: `/api/staff/stock/products/${first.id}`,
    headers: staff.headers,
  });
  assert.equal(blockedDelete.statusCode, 409);
  assert.deepEqual(blockedDelete.json(), { code: 'product_has_history' });

  const createdEmpty = await app.inject({
    method: 'POST',
    url: '/api/staff/stock/products',
    headers: staff.headers,
    payload: {
      code: 'MED-DRAFT',
      name: 'Borrador sin stock',
      quantityUnit: 'caja',
      priceClp: null,
      saleCondition: null,
      isPublished: false,
      initialStock: 0,
      operationId: randomUUID(),
    },
  });
  assert.equal(createdEmpty.statusCode, 201, createdEmpty.body);
  const draftId = createdEmpty.json<{ id: string }>().id;

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/staff/stock/products/${draftId}`,
    headers: staff.headers,
  });
  assert.equal(deleted.statusCode, 204, deleted.body);

  const finalList = await app.inject({ method: 'GET', url: '/api/staff/stock', headers: staff.headers });
  assert.equal(finalList.statusCode, 200);
  assert.equal(finalList.json<{ id: string }[]>().length, 1);

  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/inventory-movements', headers: buyer.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/inventory-movements', headers: staff.headers })).statusCode, 403);
  const auditAll = await app.inject({ method: 'GET', url: '/api/admin/inventory-movements', headers: admin.headers });
  assert.equal(auditAll.statusCode, 200, auditAll.body);
  const auditRows = auditAll.json<{ movementType: string; actorEmail: string | null; productCode: string }[]>();
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[0]?.actorEmail, 'staff@example.test');
  assert.equal(auditRows[0]?.productCode, 'MED-100');
  const auditAdjustments = await app.inject({
    method: 'GET',
    url: '/api/admin/inventory-movements?movementType=adjustment&q=conteo',
    headers: admin.headers,
  });
  assert.equal(auditAdjustments.statusCode, 200);
  assert.equal(auditAdjustments.json<unknown[]>().length, 1);
});
