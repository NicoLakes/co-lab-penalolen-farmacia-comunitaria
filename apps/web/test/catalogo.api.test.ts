import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { listarMedicamentos } from '../src/features/catalogo/medicamentos.api.js';

const VALIDO = {
  codigo: '11313',
  principioActivo: 'AC. ACETIL SALICILICO 100 MG',
  descriptor: 'ACIDO ACETILSALICILICO 100 MG X 100 COMP',
  formaFarmaceutica: 'COMPRIMIDO',
  presentacion: '100 comprimidos',
  proveedor: 'MINTLAB',
  clasificacionTerapeutica: 'CARDIOVASCULAR',
  precio: 1490,
  stock: 45,
  requiereReceta: false,
};

afterEach(() => mock.restoreAll());

test('lista el catálogo usando una ruta relativa y un timeout', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => Response.json({ medicamentos: [VALIDO] }),
  );

  const lista = await listarMedicamentos();

  assert.deepEqual(lista, [VALIDO]);
  const call = fetchMock.mock.calls[0];
  assert.ok(call);
  assert.equal(call.arguments[0], '/api/medicamentos');
  assert.ok(call.arguments[1]?.signal instanceof AbortSignal);
});

test('rechaza errores HTTP', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(listarMedicamentos(), /No se pudo cargar el catálogo/);
});

test('rechaza respuestas sin la lista de medicamentos', async () => {
  for (const body of [null, {}, { medicamentos: 'no' }, 'ok']) {
    mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(listarMedicamentos(), /respuesta inválida/);
    mock.restoreAll();
  }
});

test('rechaza medicamentos que no cumplen el contrato', async () => {
  const incompleto = { ...VALIDO };
  delete (incompleto as Partial<typeof VALIDO>).stock;

  const tiposInvalidos = [
    { ...VALIDO, precio: '1490' },
    { ...VALIDO, requiereReceta: 'no' },
    incompleto,
    null,
  ];

  for (const medicamento of tiposInvalidos) {
    mock.method(globalThis, 'fetch', async () => Response.json({ medicamentos: [medicamento] }));
    await assert.rejects(listarMedicamentos(), /formato inválido/);
    mock.restoreAll();
  }
});
