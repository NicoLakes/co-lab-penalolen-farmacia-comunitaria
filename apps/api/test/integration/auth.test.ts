import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { authVerifications, inventoryBalances, inventoryLocations, orders, products, userRoles } from '@farmacia/database/schema';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { setUserRole } from '../../src/modules/auth/access.js';
import { registerAccessRoutes } from '../../src/modules/auth/access-routes.js';
import { createAuth } from '../../src/modules/auth/auth.js';
import { recordInventoryMovement } from '../../src/modules/inventory/inventory.service.js';
import { confirmOrderPayment } from '../../src/modules/orders/order-lifecycle.js';
import { isolatedDatabase } from './isolated-database.js';

test('Better Auth sessions enforce role changes and order ownership at the HTTP boundary', async (t) => {
  const db = await isolatedDatabase(t);
  const origin = 'https://farmacia.example.test';
  const codes = new Map<string, string>();
  const [location] = await db.insert(inventoryLocations).values({ code: randomUUID(), name: randomUUID() }).returning();
  const [product] = await db.insert(products).values({
    code: randomUUID(), name: 'Synthetic product', quantityUnit: 'package', inventoryTracking: 'quantity_only',
    isPublished: true, saleCondition: 'direct_sale', priceClp: 2000,
  }).returning();
  assert.ok(location && product);
  const [balance] = await db.insert(inventoryBalances).values({ productId: product.id, locationId: location.id }).returning();
  assert.ok(balance);
  await recordInventoryMovement(db, 'test:stock', {
    operationId: randomUUID(), balanceId: balance.id, movementType: 'opening', quantityDelta: 3, reason: 'Synthetic stock',
  });
  const app = buildApp();
  t.after(() => app.close());
  registerAccessRoutes(app, {
    db, origin, auth: createAuth(db, {
      origin, secret: randomBytes(32).toString('hex'),
      sendCode: async (email, code) => { codes.set(email, code); },
    }),
    orderPolicy: { locationIds: [location.id], reservationSeconds: 300, deliveryFeeClp: 0 },
  });

  const requestCode = (email: string, remoteAddress: string) => app.inject({
    method: 'POST', url: '/api/auth/email-otp/send-verification-otp', headers: { origin }, remoteAddress,
    payload: { email, type: 'sign-in' },
  });
  const verifyCode = (email: string, otp: string, remoteAddress: string) => app.inject({
    method: 'POST', url: '/api/auth/sign-in/email-otp', headers: { origin }, remoteAddress, payload: { email, otp },
  });
  async function signIn(email: string, remoteAddress: string, checkOneTimeCode = false) {
    const sent = await requestCode(email, remoteAddress);
    assert.equal(sent.statusCode, 200, sent.body);
    const code = codes.get(email);
    assert.ok(code);
    if (checkOneTimeCode) {
      const stored = await db.select().from(authVerifications);
      assert.ok(stored.length > 0);
      assert.ok(stored.every((row) => row.value.split(':')[0] !== code));
      const wrongCode = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;
      assert.equal((await verifyCode(email, wrongCode, remoteAddress)).statusCode, 400);
    }
    const signedIn = await verifyCode(email, code, remoteAddress);
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    assert.deepEqual(signedIn.json(), { ok: true });
    const rawCookie = signedIn.headers['set-cookie'];
    assert.ok(rawCookie);
    const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
    assert.ok(cookieHeaders.some((value) => /HttpOnly/i.test(value) && /Secure/i.test(value)));
    const headers = { origin, cookie: cookieHeaders.map((value) => value.split(';', 1)[0]).join('; ') };
    const me = await app.inject({ method: 'GET', url: '/api/me', headers });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.headers['cache-control'], 'no-store');
    const profile = me.json<{ id: string; email: string; roles: string[] }>();
    assert.equal(profile.email, email);
    assert.deepEqual(profile.roles, []);
    if (checkOneTimeCode) assert.equal((await verifyCode(email, code, remoteAddress)).statusCode, 400);
    return { id: profile.id, headers };
  }

  assert.equal((await app.inject({ method: 'GET', url: '/api/orders' })).statusCode, 401);
  const blockedOrigin = await app.inject({
    method: 'POST', url: '/api/auth/email-otp/send-verification-otp', headers: { origin: 'https://other.example.test' },
    payload: { email: 'blocked@example.test', type: 'sign-in' },
  });
  assert.equal(blockedOrigin.statusCode, 403);
  assert.equal(codes.size, 0);
  const admin = await signIn('admin@example.test', '192.0.2.1', true);
  const buyer = await signIn('buyer@example.test', '192.0.2.2');
  const other = await signIn('other@example.test', '192.0.2.3');
  const operator = await signIn('operator@example.test', '192.0.2.4');
  assert.equal(await setUserRole(db, admin.id, 'user_admin', true), 'ok');

  const payload = {
    idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], fulfillment: { method: 'pickup' },
  };
  assert.equal((await app.inject({ method: 'POST', url: '/api/orders', headers: buyer.headers, payload })).statusCode, 403);
  const roleUrl = (id: string, role = 'buyer') => `/api/admin/users/${id}/roles/${role}`;
  assert.equal((await app.inject({ method: 'PUT', url: roleUrl(other.id), headers: buyer.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: roleUrl(buyer.id, 'user_admin'), headers: admin.headers })).statusCode, 400);
  const lookup = await app.inject({
    method: 'POST', url: '/api/admin/users/lookup', headers: admin.headers, payload: { email: 'buyer@example.test' },
  });
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.json<{ id: string }>().id, buyer.id);
  for (const [id, role] of [[buyer.id, 'buyer'], [other.id, 'buyer'], [operator.id, 'pharmacy_operator']] as const) {
    const grant = await app.inject({ method: 'PUT', url: roleUrl(id, role), headers: admin.headers });
    assert.equal(grant.statusCode, 204, grant.body);
  }
  assert.equal((await app.inject({ method: 'PUT', url: roleUrl(buyer.id), headers: admin.headers })).statusCode, 204);

  const created = await app.inject({
    method: 'POST', url: '/api/orders', headers: buyer.headers,
    payload: { ...payload, buyerId: other.id },
  });
  assert.equal(created.statusCode, 200, created.body);
  const view = created.json<{ id: string; totalClp: string }>();
  assert.equal(view.totalClp, '2000');
  const [order] = await db.select().from(orders).where(eq(orders.id, view.id));
  assert.equal(order?.buyerId, buyer.id);
  const url = `/api/orders/${view.id}`;
  assert.equal((await app.inject({ method: 'GET', url, headers: buyer.headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url, headers: other.headers })).statusCode, 404);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/orders', headers: other.headers })).json(), []);
  assert.equal((await app.inject({
    method: 'POST', url: `${url}/cancel`, headers: other.headers, payload: { operationId: randomUUID() },
  })).statusCode, 404);

  const staffUrl = `/api/fulfillment/orders/${view.id}`;
  assert.equal((await app.inject({ method: 'GET', url: staffUrl, headers: operator.headers })).statusCode, 404);
  await confirmOrderPayment(db, view.id, 2000n, { operationId: randomUUID(), actorReference: 'test:payment' });
  assert.equal((await app.inject({ method: 'GET', url: staffUrl, headers: operator.headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: staffUrl, headers: admin.headers })).statusCode, 403);
  const completed = await app.inject({
    method: 'POST', url: `${staffUrl}/fulfill`, headers: operator.headers, payload: { operationId: randomUUID() },
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json<{ status: string }>().status, 'fulfilled');

  assert.equal((await app.inject({ method: 'DELETE', url: roleUrl(buyer.id), headers: admin.headers })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url, headers: buyer.headers })).statusCode, 403);
  const history = await db.select().from(userRoles).where(and(eq(userRoles.userId, buyer.id), eq(userRoles.role, 'buyer')));
  assert.equal(history.length, 1);
  assert.equal(history[0]?.grantedByUserId, admin.id);
  assert.equal(history[0]?.revokedByUserId, admin.id);
  assert.ok(history[0]?.revokedAt);

  const disabled = await app.inject({
    method: 'PATCH', url: `/api/admin/users/${other.id}/status`, headers: admin.headers, payload: { status: 'disabled' },
  });
  assert.equal(disabled.statusCode, 204, disabled.body);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: other.headers })).statusCode, 401);
  assert.equal((await requestCode('other@example.test', '192.0.2.3')).statusCode, 200);
  const code = codes.get('other@example.test');
  assert.ok(code);
  const blockedLogin = await verifyCode('other@example.test', code, '192.0.2.3');
  assert.equal(blockedLogin.statusCode, 403);
  assert.equal(blockedLogin.headers['set-cookie'], undefined);

  const signedOut = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: buyer.headers, payload: {} });
  assert.equal(signedOut.statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: buyer.headers })).statusCode, 401);
});
