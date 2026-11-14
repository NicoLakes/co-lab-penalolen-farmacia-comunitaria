import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  iniciarSesionVecino,
  pedidosDelVecino,
  registrarVecino,
} from '../src/features/cuenta/cuenta.api.js';

afterEach(() => mock.restoreAll());

test('registrarVecino crea la cuenta con los datos que usa el checkout', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      Response.json({
        vecino: { id: 'v1', nombre: 'Ana Pérez', email: 'ana@correo.cl' },
      }),
  );

  const vecino = await registrarVecino(
    'Ana Pérez',
    'ana@correo.cl',
    '987654321',
    'Av. Siempreviva 742',
    'secreta1',
  );

  assert.equal(vecino.email, 'ana@correo.cl');
  const call = fetchMock.mock.calls[0];
  assert.equal(call?.arguments[0], '/api/vecinos/registro');
  assert.equal(call?.arguments[1]?.method, 'POST');
  assert.match(String(call?.arguments[1]?.body), /secreta1/);
  assert.match(String(call?.arguments[1]?.body), /987654321/);
  assert.match(String(call?.arguments[1]?.body), /Av\. Siempreviva 742/);
});

test('iniciarSesionVecino envía credenciales y devuelve el vecino', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      Response.json({ vecino: { id: 'v1', nombre: 'Ana', email: 'ana@correo.cl' } }),
  );

  const vecino = await iniciarSesionVecino('ana@correo.cl', 'secreta1');

  assert.equal(vecino.id, 'v1');
  assert.equal(String(fetchMock.mock.calls[0]?.arguments[0]), '/api/vecinos/login');
});

test('propaga el mensaje de error de la API', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: 'Correo o contraseña incorrectos.' }), { status: 401 }),
  );

  await assert.rejects(iniciarSesionVecino('x@y.cl', 'mala'), /Correo o contraseña incorrectos/);
});

test('pedidosDelVecino devuelve la lista asociada a la cuenta', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      Response.json({
        pedidos: [
          {
            numero: 3,
            estado: 'RECIBIDO',
            modalidad: 'DELIVERY',
            direccion: 'Av. Siempreviva 742',
            items: [],
            total: 2500,
            creadoEn: '2026-11-14T10:00:00.000Z',
            actualizadoEn: '2026-11-14T10:00:00.000Z',
          },
        ],
      }),
  );

  const pedidos = await pedidosDelVecino();

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0]?.numero, 3);
  assert.equal(String(fetchMock.mock.calls[0]?.arguments[0]), '/api/vecinos/pedidos');
});
