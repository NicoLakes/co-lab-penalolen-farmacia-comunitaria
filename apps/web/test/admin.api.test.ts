import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  cambiarEstadoPedido,
  eliminarMedicamento,
  iniciarSesion,
  listarPedidos,
} from '../src/features/admin/admin.api.js';

afterEach(() => mock.restoreAll());

test('iniciarSesion envía credenciales y devuelve el usuario', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      Response.json({
        usuario: { id: 'u1', nombre: 'Admin', email: 'admin@farmacia.local', rol: 'admin' },
      }),
  );

  const usuario = await iniciarSesion('admin@farmacia.local', 'admin123');

  assert.equal(usuario.rol, 'admin');
  const call = fetchMock.mock.calls[0];
  assert.ok(call);
  assert.equal(call.arguments[0], '/api/auth/login');
  assert.equal(call.arguments[1]?.method, 'POST');
  assert.match(String(call.arguments[1]?.body), /admin123/);
});

test('propaga el mensaje de error de la API', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ error: 'Correo o contraseña incorrectos.' }), { status: 401 }),
  );
  await assert.rejects(iniciarSesion('x@y.cl', 'mala'), /Correo o contraseña incorrectos/);
});

test('listaPedidos acepta filtro por estado en la query', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => Response.json({ pedidos: [] }),
  );

  await listarPedidos('EN_DESPACHO');
  assert.match(String(fetchMock.mock.calls[0]?.arguments[0]), /estado=EN_DESPACHO$/);

  await listarPedidos();
  assert.equal(String(fetchMock.mock.calls[1]?.arguments[0]), '/api/admin/pedidos');
});

test('eliminarMedicamento llama al borrado definitivo con DELETE', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

  await eliminarMedicamento('m1');

  const call = fetchMock.mock.calls[0];
  assert.equal(String(call?.arguments[0]), '/api/admin/medicamentos/m1/definitivo');
  assert.equal(call?.arguments[1]?.method, 'DELETE');
});

test('cambiarEstadoPedido hace PATCH con el nuevo estado', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => Response.json({ pedido: { id: 'p1', estado: 'EN_PREPARACION' } }),
  );

  const pedido = await cambiarEstadoPedido('p1', 'EN_PREPARACION');

  assert.equal(pedido.estado, 'EN_PREPARACION');
  const call = fetchMock.mock.calls[0];
  assert.match(String(call?.arguments[0]), /\/api\/admin\/pedidos\/p1\/estado$/);
  assert.equal(call?.arguments[1]?.method, 'PATCH');
  assert.equal(call?.arguments[1]?.body, '{"estado":"EN_PREPARACION"}');
});
