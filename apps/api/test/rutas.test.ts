import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('GET /api/medicamentos devuelve la lista pública sin sesión', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  // Sin DATABASE_URL no hay BD: la ruta debe fallar como 500, nunca como 401.
  const response = await app.inject({ method: 'GET', url: '/api/medicamentos' });
  assert.ok([200, 500].includes(response.statusCode));
  if (response.statusCode === 200) {
    assert.ok(Array.isArray(response.json().medicamentos));
  }
});

test('las rutas del panel exigen sesión', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const medicamentoValido = {
    codigo: '1',
    principioActivo: 'X',
    descriptor: 'X',
    formaFarmaceutica: 'COMPRIMIDO',
    presentacion: '1 caja',
    proveedor: 'LAB',
    clasificacionTerapeutica: 'TEST',
    precio: 100,
    stock: 1,
    requiereReceta: false,
  };

  const rutas = [
    { method: 'GET' as const, url: '/api/admin/medicamentos' },
    { method: 'POST' as const, url: '/api/admin/medicamentos', payload: medicamentoValido },
    { method: 'DELETE' as const, url: '/api/admin/medicamentos/abc/definitivo' },
    { method: 'GET' as const, url: '/api/admin/pedidos' },
    { method: 'GET' as const, url: '/api/admin/pedidos/abc' },
    { method: 'PATCH' as const, url: '/api/admin/pedidos/abc/estado', payload: { estado: 'RECIBIDO' } },
  ];

  for (const ruta of rutas) {
    const response = await app.inject(ruta);
    assert.equal(response.statusCode, 401, `${ruta.method} ${ruta.url}`);
    assert.match(response.json().error, /iniciar sesión/);
  }
});

test('una cookie de sesión falsa nunca da acceso', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/pedidos',
    headers: { cookie: 'farmacia_sesion=token-inexistente' },
  });

  // 401 con BD disponible; 500 si no hay BD que consultar (el acceso sigue negado).
  assert.ok([401, 500].includes(response.statusCode));
  assert.notEqual(response.statusCode, 200);
});

test('POST /api/auth/login valida el cuerpo antes de tocar la base', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    {},
    { email: 'x' },
    { password: 'x' },
    { email: 'a@b.cl', password: 'x', extra: 1 },
    { email: 42, password: 'x' },
  ];

  for (const body of invalidos) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: body,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(body));
    assert.match(response.json().error, /válidos/);
  }
});

test('POST /api/pedidos valida la solicitud sin crear nada', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    { clienteNombre: 'Ana', contacto: '999', modalidad: 'RETIRO', items: [] },
    { clienteNombre: 'Ana', contacto: '999', modalidad: 'BUSQUEO', items: [{ codigo: '1', cantidad: 1 }] },
    { clienteNombre: 'Ana', contacto: '999', modalidad: 'DELIVERY', direccion: '', items: [{ codigo: '1', cantidad: 1 }] },
    { clienteNombre: 'Ana', contacto: '999', modalidad: 'RETIRO', items: [{ codigo: '1', cantidad: 0 }] },
    { clienteNombre: 'A', contacto: '999', modalidad: 'RETIRO', items: [{ codigo: '1', cantidad: 1 }] },
  ];

  for (const body of invalidos) {
    const response = await app.inject({ method: 'POST', url: '/api/pedidos', payload: body });
    assert.equal(response.statusCode, 400, JSON.stringify(body));
    assert.match(response.json().error, /válidos/);
  }
});

test('el cambio de estado valida el enum sin sesión previa', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/admin/pedidos/abc/estado',
    payload: { estado: 'INVENTADO' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /válidos/);
});
