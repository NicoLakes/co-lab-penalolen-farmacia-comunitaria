import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { checkApiHealth } from '../src/api/health.js';

afterEach(() => mock.restoreAll());

test('consulta la API usando una ruta relativa y un timeout', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ status: 'ok' }));

  await checkApiHealth();

  const call = fetchMock.mock.calls[0];
  assert.ok(call);
  assert.equal(call.arguments[0], '/api/health');
  assert.ok(call.arguments[1]?.signal instanceof AbortSignal);
});

test('rechaza errores HTTP', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(checkApiHealth(), /no está disponible/);
});

test('rechaza respuestas que no cumplen el contrato', async () => {
  for (const body of [null, {}, { status: 'error' }, 'ok']) {
    mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(checkApiHealth(), /respuesta inválida/);
    mock.restoreAll();
  }
});

test('propaga fallos de red y JSON inválido', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network error'); });
  await assert.rejects(checkApiHealth(), TypeError);

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('invalid json'));
  await assert.rejects(checkApiHealth(), SyntaxError);
});
