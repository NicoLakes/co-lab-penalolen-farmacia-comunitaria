import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { consultarPedido } from '../src/features/seguimiento/seguimiento.api.js';

afterEach(() => mock.restoreAll());

test('consultarPedido envía número y contacto en la query (HU-07)', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () =>
      Response.json({
        pedido: {
          numero: 12,
          estado: 'EN_PREPARACION',
          modalidad: 'RETIRO',
          direccion: null,
          items: [],
          total: 1000,
          creadoEn: '2026-11-14T10:00:00.000Z',
          actualizadoEn: '2026-11-14T11:00:00.000Z',
          historial: [{ estado: 'EN_PREPARACION', registradoEn: '2026-11-14T11:00:00.000Z' }],
        },
      }),
  );

  const pedido = await consultarPedido(12, '987654321');

  assert.equal(pedido.numero, 12);
  assert.equal(pedido.estado, 'EN_PREPARACION');
  assert.equal(pedido.historial.length, 1);

  const url = String(fetchMock.mock.calls[0]?.arguments[0]);
  assert.match(url, /^\/api\/pedidos\/seguimiento\?/);
  assert.match(url, /numero=12/);
  assert.match(url, /contacto=987654321/);
});

test('consultarPedido propaga el mensaje de error de la API', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ error: 'No encontramos un pedido con ese número y contacto.' }),
        { status: 404 },
      ),
  );

  await assert.rejects(consultarPedido(999, '987654321'), /No encontramos un pedido/);
});

test('consultarPedido falla si la respuesta no trae pedido', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(consultarPedido(1, '999'), /respuesta del servidor/);
});
