import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import {
  MESES_VIGENCIA_RECETA,
  recetaVigente,
  vencimientoReceta,
} from '../src/modules/recetas/recetas.service.js';

const archivoValido = {
  nombre: 'receta.pdf',
  tipo: 'application/pdf',
  datos: Buffer.from('%PDF-1.4 receta').toString('base64'),
};

test('adjuntar una receta exige sesión del vecino', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const sinSesion = await app.inject({
    method: 'POST',
    url: '/api/vecinos/recetas',
    payload: archivoValido,
  });
  assert.equal(sinSesion.statusCode, 401);
  assert.match(sinSesion.json().error, /iniciar sesión/);

  const listado = await app.inject({ method: 'GET', url: '/api/vecinos/recetas' });
  assert.equal(listado.statusCode, 401);
});

test('la subida de receta valida archivo y tipo antes de guardar', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    {},
    { ...archivoValido, nombre: '' },
    { ...archivoValido, tipo: 'text/plain' },
    { ...archivoValido, datos: '' },
    { ...archivoValido, extra: 1 },
  ];

  for (const payload of invalidos) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vecinos/recetas',
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test('la revisión de recetas exige sesión del panel', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const rutas = [
    { method: 'GET' as const, url: '/api/admin/recetas' },
    { method: 'GET' as const, url: '/api/admin/recetas/abc/archivo' },
    {
      method: 'POST' as const,
      url: '/api/admin/recetas/abc/estado',
      payload: { estado: 'RECHAZADA' },
    },
  ];

  for (const ruta of rutas) {
    const response = await app.inject(ruta);
    assert.equal(response.statusCode, 401, `${ruta.method} ${ruta.url}`);
    assert.match(response.json().error, /iniciar sesión/);
  }
});

test('la evaluación de receta solo admite estados y medicamentos válidos', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    { estado: 'PENDIENTE' },
    { estado: 'ACEPTADA', items: [{ codigo: '', cantidad: 1 }] },
    { estado: 'ACEPTADA', items: [{ codigo: 'A1', cantidad: 0 }] },
    { estado: 'RECHAZADA', extra: true },
  ];

  for (const payload of invalidos) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/recetas/abc/estado',
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test('el filtro de recetas del panel valida el estado', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/recetas?estado=OTRO',
  });
  assert.equal(response.statusCode, 400);
});

test('la receta aceptada vence a los 6 meses de la revisión', () => {
  const revisadoEn = new Date(2026, 0, 15, 12);
  const vence = vencimientoReceta({
    estado: 'ACEPTADA',
    creadoEn: new Date(2026, 0, 1, 9),
    revisadoEn,
  });
  assert.equal(MESES_VIGENCIA_RECETA, 6);
  assert.equal(vence?.getFullYear(), 2026);
  assert.equal(vence?.getMonth(), 6);
  assert.equal(vence?.getDate(), 15);
  assert.equal(vence?.getHours(), 12);
});

test('el vencimiento ajusta el fin de mes al sumar la vigencia', () => {
  const vence = vencimientoReceta({
    estado: 'ACEPTADA',
    creadoEn: new Date(2026, 7, 31, 12),
    revisadoEn: new Date(2026, 7, 31, 12),
  });
  assert.equal(vence?.getFullYear(), 2027);
  assert.equal(vence?.getMonth(), 1);
  assert.equal(vence?.getDate(), 28);
});

test('una receta vencida deja de autorizar medicamentos', () => {
  const receta = {
    estado: 'ACEPTADA',
    creadoEn: new Date(2025, 0, 1, 12),
    revisadoEn: new Date(2025, 0, 1, 12),
  };
  assert.equal(recetaVigente(receta, new Date(2025, 5, 30, 12)), true);
  assert.equal(recetaVigente(receta, new Date(2025, 6, 2, 12)), false);
});

test('las recetas pendientes o rechazadas no tienen vencimiento', () => {
  for (const estado of ['PENDIENTE', 'RECHAZADA']) {
    assert.equal(
      vencimientoReceta({ estado, creadoEn: new Date(), revisadoEn: null }),
      null,
    );
  }
});
