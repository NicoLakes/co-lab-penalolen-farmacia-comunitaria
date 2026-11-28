import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { inventoryBalances, inventoryLocations, products } from '@farmacia/database/schema';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { setUserRole } from '../../src/modules/auth/access.js';
import { registerAccessRoutes } from '../../src/modules/auth/access-routes.js';
import { createAuth } from '../../src/modules/auth/auth.js';
import { recordInventoryMovement } from '../../src/modules/inventory/inventory.service.js';
import type { OrderEmailMessage } from '../../src/modules/orders/order-notifications.js';
import { createMemoryPrescriptionStorage } from '../../src/modules/orders/prescription-storage.js';
import { isolatedDatabase } from './isolated-database.js';

const validPdfBase64 = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8').toString('base64');
const invalidPdfBase64 = Buffer.from('<html>not a pdf</html>', 'utf8').toString('base64');

test('prescription orders enforce stock reservation, private file access, pharmacist review and email notifications', async (t) => {
  const db = await isolatedDatabase(t);
  const origin = 'https://farmacia.example.test';
  const codes = new Map<string, string>();
  const sentEmails: OrderEmailMessage[] = [];
  const storage = createMemoryPrescriptionStorage();

  const [location] = await db.insert(inventoryLocations).values({
    code: 'CENTRAL',
    name: 'Farmacia Central',
  }).returning();
  assert.ok(location);

  async function seedProduct(
    code: string,
    name: string,
    saleCondition: 'direct_sale' | 'simple_prescription' | 'prescription_cheque',
    stockQuantity: number,
  ) {
    const [product] = await db.insert(products).values({
      code,
      name,
      quantityUnit: 'package',
      priceClp: 3500,
      saleCondition,
      isPublished: true,
      inventoryTracking: 'quantity_only',
    }).returning();
    assert.ok(product);
    const [balance] = await db.insert(inventoryBalances).values({
      productId: product.id,
      locationId: location!.id,
    }).returning();
    assert.ok(balance);
    if (stockQuantity > 0) {
      await recordInventoryMovement(db, 'test:setup', {
        balanceId: balance.id,
        movementType: 'opening',
        quantityDelta: stockQuantity,
        reason: 'Initial test stock',
        operationId: randomUUID(),
      });
    }
    return { product, balance };
  }

  const rxSimple = await seedProduct('RX-100', 'Acenocumarol 4 mg', 'simple_prescription', 3);
  const rxCheque = await seedProduct('RX-CHQ', 'Estupefaciente Controlado', 'prescription_cheque', 5);
  const otc = await seedProduct('OTC-100', 'Paracetamol 500 mg', 'direct_sale', 5);

  const app = buildApp();
  t.after(() => app.close());
  const orderPolicy = {
    locationIds: [location.id],
    reservationSeconds: 900,
    prescriptionPaymentSeconds: 259_200,
    deliveryFeeClp: 1500,
  };
  registerAccessRoutes(app, {
    db,
    origin,
    auth: createAuth(db, {
      origin,
      secret: randomBytes(32).toString('hex'),
      sendCode: async (email, code) => { codes.set(email, code); },
    }),
    orderPolicy,
    demoPayments: true,
    prescriptionStorage: storage,
    sendEmail: async (message) => { sentEmails.push(message); },
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

  const admin = await signIn('admin@example.test', '192.0.2.20');
  const staff = await signIn('staff@example.test', '192.0.2.21');
  const buyer1 = await signIn('vecino1@example.test', '192.0.2.22');
  const buyer2 = await signIn('vecino2@example.test', '192.0.2.23');

  assert.equal(await setUserRole(db, admin.id, 'user_admin', true), 'ok');
  assert.equal(await setUserRole(db, staff.id, 'pharmacy_operator', true, admin.id), 'ok');
  assert.equal(await setUserRole(db, buyer1.id, 'buyer', true, admin.id), 'ok');
  assert.equal(await setUserRole(db, buyer2.id, 'buyer', true, admin.id), 'ok');

  // 1. Rejects prescription_cheque (DS 466) and spoofed file content
  const chequeBlocked = await app.inject({
    method: 'POST', url: '/api/orders/prescription', headers: buyer1.headers,
    payload: {
      idempotencyKey: randomUUID(),
      items: [{ productId: rxCheque.product.id, quantity: 1 }],
      fulfillment: { method: 'pickup' },
      prescription: { fileName: 'receta.pdf', mimeType: 'application/pdf', contentBase64: validPdfBase64 },
    },
  });
  assert.equal(chequeBlocked.statusCode, 409);
  assert.equal(chequeBlocked.json<{ code: string }>().code, 'unavailable_product');

  const spoofedFile = await app.inject({
    method: 'POST', url: '/api/orders/prescription', headers: buyer1.headers,
    payload: {
      idempotencyKey: randomUUID(),
      items: [{ productId: rxSimple.product.id, quantity: 1 }],
      fulfillment: { method: 'pickup' },
      prescription: { fileName: 'fake.pdf', mimeType: 'application/pdf', contentBase64: invalidPdfBase64 },
    },
  });
  assert.equal(spoofedFile.statusCode, 400);
  assert.equal(spoofedFile.json<{ code: string }>().code, 'invalid_input');

  // 2. Rejects when requested quantity exceeds stock and reports exact productNames
  const outOfStock = await app.inject({
    method: 'POST', url: '/api/orders/prescription', headers: buyer1.headers,
    payload: {
      idempotencyKey: randomUUID(),
      items: [{ productId: rxSimple.product.id, quantity: 5 }],
      fulfillment: { method: 'pickup' },
      prescription: { fileName: 'receta.pdf', mimeType: 'application/pdf', contentBase64: validPdfBase64 },
    },
  });
  assert.equal(outOfStock.statusCode, 409);
  assert.deepEqual(outOfStock.json(), {
    code: 'insufficient_stock',
    productNames: ['Acenocumarol 4 mg'],
  });

  // 3. Creates a mixed prescription + OTC order in pending_review and reserves stock immediately
  const createKey = randomUUID();
  const createdRes = await app.inject({
    method: 'POST', url: '/api/orders/prescription', headers: buyer1.headers,
    payload: {
      idempotencyKey: createKey,
      items: [
        { productId: rxSimple.product.id, quantity: 2 },
        { productId: otc.product.id, quantity: 1 },
      ],
      fulfillment: { method: 'pickup' },
      prescription: { fileName: 'receta-marzo.pdf', mimeType: 'application/pdf', contentBase64: validPdfBase64 },
    },
  });
  assert.equal(createdRes.statusCode, 201, createdRes.body);
  const created = createdRes.json<{
    id: string;
    orderNumber: string;
    status: string;
    reservationExpiresAt: string | null;
    prescription: { fileName: string; status: string };
  }>();
  assert.equal(created.status, 'pending_review');
  assert.equal(created.reservationExpiresAt, null);
  assert.equal(created.prescription.fileName, 'receta-marzo.pdf');
  assert.equal(created.prescription.status, 'pending');

  // Stock must already be reserved while pending_review!
  const [rxBalanceAfterCreate] = await db.select().from(inventoryBalances)
    .where(eq(inventoryBalances.id, rxSimple.balance.id));
  assert.equal(rxBalanceAfterCreate?.reservedQuantity, 2);

  // 4. Private file download: owner and staff succeed, other buyer gets 404
  const ownerDownload = await app.inject({
    method: 'GET', url: `/api/orders/${created.id}/prescription`, headers: buyer1.headers,
  });
  assert.equal(ownerDownload.statusCode, 200);
  assert.equal(ownerDownload.headers['content-type'], 'application/pdf');
  assert.equal(ownerDownload.headers['x-content-type-options'], 'nosniff');
  assert.equal(ownerDownload.headers['content-security-policy'], 'sandbox');
  assert.equal(ownerDownload.rawPayload.toString('base64'), validPdfBase64);

  const otherBuyerDownload = await app.inject({
    method: 'GET', url: `/api/orders/${created.id}/prescription`, headers: buyer2.headers,
  });
  assert.equal(otherBuyerDownload.statusCode, 404);

  const staffDownload = await app.inject({
    method: 'GET', url: `/api/fulfillment/orders/${created.id}/prescription`, headers: staff.headers,
  });
  assert.equal(staffDownload.statusCode, 200);
  assert.equal(staffDownload.rawPayload.toString('base64'), validPdfBase64);

  // 5. Staff sees order in pending_review queue and approves it -> pending_payment (3 days) + email sent once
  const reviewQueue = await app.inject({
    method: 'GET', url: '/api/fulfillment/orders?status=pending_review', headers: staff.headers,
  });
  assert.equal(reviewQueue.statusCode, 200);
  assert.equal(reviewQueue.json<{ id: string }[]>().length, 1);

  const approveOpId = randomUUID();
  const approvedRes = await app.inject({
    method: 'POST', url: `/api/fulfillment/orders/${created.id}/approve-prescription`, headers: staff.headers,
    payload: { operationId: approveOpId },
  });
  assert.equal(approvedRes.statusCode, 200, approvedRes.body);
  const approved = approvedRes.json<{
    status: string;
    reservationExpiresAt: string | null;
    prescription: { status: string };
    notificationSent: boolean;
  }>();
  assert.equal(approved.status, 'pending_payment');
  assert.ok(approved.reservationExpiresAt);
  const hoursUntilExpiry = (new Date(approved.reservationExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60);
  assert.ok(hoursUntilExpiry > 71 && hoursUntilExpiry <= 72.1, `Expected ~72h window, got ${hoursUntilExpiry}`);
  assert.equal(approved.prescription.status, 'approved');
  assert.equal(approved.notificationSent, true);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.to, 'vecino1@example.test');
  assert.match(sentEmails[0]?.subject ?? '', new RegExp(created.orderNumber));

  // Idempotent retry does NOT send a duplicate email
  const retryApprove = await app.inject({
    method: 'POST', url: `/api/fulfillment/orders/${created.id}/approve-prescription`, headers: staff.headers,
    payload: { operationId: approveOpId },
  });
  assert.equal(retryApprove.statusCode, 200);
  assert.equal(sentEmails.length, 1);

  // 6. Buyer pays approved prescription order and staff fulfills it (proving prescription products fulfill cleanly!)
  const paidRes = await app.inject({
    method: 'POST', url: `/api/orders/${created.id}/pay`, headers: buyer1.headers,
    payload: { operationId: randomUUID() },
  });
  assert.equal(paidRes.statusCode, 200, paidRes.body);
  assert.equal(paidRes.json<{ status: string }>().status, 'confirmed');

  const fulfilledRes = await app.inject({
    method: 'POST', url: `/api/fulfillment/orders/${created.id}/fulfill`, headers: staff.headers,
    payload: { operationId: randomUUID() },
  });
  assert.equal(fulfilledRes.statusCode, 200, fulfilledRes.body);
  assert.equal(fulfilledRes.json<{ status: string }>().status, 'fulfilled');

  const historyUrl = `/api/orders/${created.id}`;
  const ownerHistory = await app.inject({ method: 'GET', url: historyUrl, headers: buyer1.headers });
  assert.equal(ownerHistory.statusCode, 200);
  const history = ownerHistory.json<{ history: { status: string; occurredAt: string }[] }>().history;
  assert.deepEqual(history.map(({ status }) => status), ['pending_review', 'pending_payment', 'confirmed', 'fulfilled']);
  for (const event of history) {
    assert.deepEqual(Object.keys(event).sort(), ['occurredAt', 'status']);
    assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  }
  const privateHistory = await app.inject({ method: 'GET', url: historyUrl, headers: buyer2.headers });
  assert.equal(privateHistory.statusCode, 404);

  const queue = '/api/fulfillment/orders?status=fulfilled&sort=newest&method=';
  const pickupQueue = await app.inject({ method: 'GET', url: queue + 'pickup', headers: staff.headers });
  assert.equal(pickupQueue.statusCode, 200);
  assert.deepEqual(pickupQueue.json<{ id: string }[]>().map(({ id }) => id), [created.id]);
  const deliveryQueue = await app.inject({ method: 'GET', url: queue + 'delivery', headers: staff.headers });
  assert.equal(deliveryQueue.statusCode, 200);
  assert.deepEqual(deliveryQueue.json(), []);
  const invalidQueue = await app.inject({
    method: 'GET', url: '/api/fulfillment/orders?sort=invalid', headers: staff.headers,
  });
  assert.equal(invalidQueue.statusCode, 400);

  const [rxBalanceAfterFulfill] = await db.select().from(inventoryBalances)
    .where(eq(inventoryBalances.id, rxSimple.balance.id));
  assert.equal(rxBalanceAfterFulfill?.onHandQuantity, 1);
  assert.equal(rxBalanceAfterFulfill?.reservedQuantity, 0);

  // 7. Second order rejected by staff -> releases reserved stock immediately + stores reason + sends rejection email
  const secondRes = await app.inject({
    method: 'POST', url: '/api/orders/prescription', headers: buyer2.headers,
    payload: {
      idempotencyKey: randomUUID(),
      items: [{ productId: rxSimple.product.id, quantity: 1 }],
      fulfillment: { method: 'pickup' },
      prescription: { fileName: 'receta-borrosa.pdf', mimeType: 'application/pdf', contentBase64: validPdfBase64 },
    },
  });
  assert.equal(secondRes.statusCode, 201, secondRes.body);
  const second = secondRes.json<{ id: string; orderNumber: string }>();

  const [rxBalanceDuringReview] = await db.select().from(inventoryBalances)
    .where(eq(inventoryBalances.id, rxSimple.balance.id));
  assert.equal(rxBalanceDuringReview?.reservedQuantity, 1);

  const rejectRes = await app.inject({
    method: 'POST', url: `/api/fulfillment/orders/${second.id}/reject-prescription`, headers: staff.headers,
    payload: { operationId: randomUUID(), reason: 'Receta vencida, fecha anterior a 30 días.' },
  });
  assert.equal(rejectRes.statusCode, 200, rejectRes.body);
  const rejected = rejectRes.json<{
    status: string;
    prescription: { status: string; rejectionReason: string };
    notificationSent: boolean;
  }>();
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.prescription.status, 'rejected');
  assert.equal(rejected.prescription.rejectionReason, 'Receta vencida, fecha anterior a 30 días.');
  assert.equal(rejected.notificationSent, true);
  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[1]?.to, 'vecino2@example.test');
  assert.match(sentEmails[1]?.text ?? '', /Receta vencida, fecha anterior a 30 días\./);

  const [rxBalanceAfterReject] = await db.select().from(inventoryBalances)
    .where(eq(inventoryBalances.id, rxSimple.balance.id));
  assert.equal(rxBalanceAfterReject?.onHandQuantity, 1);
  assert.equal(rxBalanceAfterReject?.reservedQuantity, 0);

  // Buyer detail includes prescription status and rejectionReason
  const buyerDetail = await app.inject({
    method: 'GET', url: `/api/orders/${second.id}`, headers: buyer2.headers,
  });
  assert.equal(buyerDetail.statusCode, 200);
  const detailJson = buyerDetail.json<{
    status: string;
    prescription: { status: string; rejectionReason: string } | null;
  }>();
  assert.equal(detailJson.status, 'rejected');
  assert.equal(detailJson.prescription?.rejectionReason, 'Receta vencida, fecha anterior a 30 días.');
});
