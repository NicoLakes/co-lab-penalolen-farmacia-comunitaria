import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OrderError } from '../src/modules/orders/order-input.js';
import {
  buildPrescriptionApprovedEmail,
  buildPrescriptionRejectedEmail,
} from '../src/modules/orders/order-notifications.js';
import {
  assertValidStorageKey,
  createLocalPrescriptionStorage,
  createPrescriptionStorageKey,
  maxPrescriptionBytes,
  validatePrescriptionFile,
} from '../src/modules/orders/prescription-storage.js';

const samplePdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8');
const sampleJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sampleWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

test('validatePrescriptionFile accepts valid PDF, JPEG, PNG and WEBP files and sanitizes filenames', () => {
  const pdf = validatePrescriptionFile({
    fileName: '../../secret/mi "receta"\n2026.pdf',
    mimeType: 'application/pdf',
    data: samplePdf,
  });
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.extension, 'pdf');
  assert.equal(pdf.fileName, 'mi receta2026.pdf');
  assert.equal(pdf.fileSizeBytes, samplePdf.length);
  assert.match(pdf.fileSha256, /^[0-9a-f]{64}$/);

  assert.equal(validatePrescriptionFile({ fileName: 'rx.jpg', mimeType: 'image/jpeg', data: sampleJpeg }).extension, 'jpg');
  assert.equal(validatePrescriptionFile({ fileName: 'rx.png', mimeType: 'image/png', data: samplePng }).extension, 'png');
  assert.equal(validatePrescriptionFile({ fileName: 'rx.webp', mimeType: 'image/webp', data: sampleWebp }).extension, 'webp');
});

test('validatePrescriptionFile rejects empty, oversized, unsupported and spoofed files', () => {
  assert.throws(
    () => validatePrescriptionFile({ fileName: 'empty.pdf', mimeType: 'application/pdf', data: Buffer.alloc(0) }),
    (error: unknown) => error instanceof OrderError && error.code === 'invalid_input',
  );
  assert.throws(
    () => validatePrescriptionFile({
      fileName: 'huge.pdf',
      mimeType: 'application/pdf',
      data: Buffer.concat([samplePdf, Buffer.alloc(maxPrescriptionBytes)]),
    }),
    (error: unknown) => error instanceof OrderError && error.code === 'invalid_input',
  );
  assert.throws(
    () => validatePrescriptionFile({
      fileName: 'script.html',
      mimeType: 'text/html',
      data: Buffer.from('<script>alert(1)</script>'),
    }),
    (error: unknown) => error instanceof OrderError && error.code === 'invalid_input',
  );
  assert.throws(
    () => validatePrescriptionFile({
      fileName: 'spoof.pdf',
      mimeType: 'application/pdf',
      data: sampleJpeg,
    }),
    (error: unknown) => error instanceof OrderError && error.code === 'invalid_input',
  );
});

test('local prescription storage rejects path traversal and persists private files safely', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'farmacia-rx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = createLocalPrescriptionStorage(dir);

  for (const badKey of ['../escape.pdf', 'sub/dir.pdf', 'foo..bar.pdf', '', '.hidden.pdf']) {
    assert.throws(() => assertValidStorageKey(badKey), OrderError);
    await assert.rejects(() => storage.read(badKey), OrderError);
  }

  const key = createPrescriptionStorageKey('pdf');
  assert.equal(await storage.read(key), null);
  await storage.save(key, samplePdf);
  assert.deepEqual(await storage.read(key), samplePdf);
  await storage.remove(key);
  assert.equal(await storage.read(key), null);
});

test('prescription notification builders include order number, reason and deadline details', () => {
  const approved = buildPrescriptionApprovedEmail({
    to: 'vecino@example.test',
    orderNumber: 'FC-42',
    totalClp: 5490n,
    reservationExpiresAt: new Date('2026-11-26T18:00:00.000Z'),
    origin: 'http://127.0.0.1:5173',
  });
  assert.equal(approved.to, 'vecino@example.test');
  assert.match(approved.subject, /FC-42/);
  assert.match(approved.text, /^Estimado\/a,/);
  assert.match(approved.text, /5\.490/);
  assert.match(approved.text, /Mis pedidos/);

  const rejected = buildPrescriptionRejectedEmail({
    to: 'vecino@example.test',
    orderNumber: 'FC-43',
    rejectionReason: 'La firma del médico no es legible.',
    origin: 'http://127.0.0.1:5173',
  });
  assert.match(rejected.subject, /FC-43/);
  assert.match(rejected.text, /^Estimado\/a,/);
  assert.match(rejected.text, /La firma del médico no es legible\./);
});
