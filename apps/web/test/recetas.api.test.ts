import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
  evaluarReceta,
  listarRecetasAdmin,
  urlArchivoReceta,
} from '../src/features/admin/recetas.api.js';

afterEach(() => mock.restoreAll());

test('listarRecetasAdmin consulta la cola con el filtro de estado', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => Response.json({ recetas: [{ id: 'r1', estado: 'PENDIENTE' }] }),
  );

  const recetas = await listarRecetasAdmin('PENDIENTE');

  assert.equal(recetas.length, 1);
  assert.equal(fetchMock.mock.calls[0]?.arguments[0], '/api/admin/recetas?estado=PENDIENTE');
});

test('evaluarReceta envía el estado y los medicamentos indicados', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => Response.json({ receta: { id: 'r1', estado: 'ACEPTADA' } }),
  );

  const receta = await evaluarReceta('r1', {
    estado: 'ACEPTADA',
    items: [{ codigo: 'A1', cantidad: 2 }],
  });

  assert.equal(receta.estado, 'ACEPTADA');
  const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
  assert.equal(url, '/api/admin/recetas/r1/estado');
  assert.equal(init?.method, 'POST');
  assert.match(String(init?.body), /"codigo":"A1"/);
  assert.match(String(init?.body), /"cantidad":2/);
});

test('urlArchivoReceta codifica el identificador', () => {
  assert.equal(urlArchivoReceta('a/b'), '/api/admin/recetas/a%2Fb/archivo');
});
