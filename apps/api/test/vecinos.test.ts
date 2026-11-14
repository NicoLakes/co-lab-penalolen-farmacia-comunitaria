import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('POST /api/vecinos/registro valida el cuerpo sin tocar la base', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    {},
    { nombre: 'A', email: 'ana@correo.cl', password: 'secreta1' },
    { nombre: 'Ana', email: 'no-es-correo', password: 'secreta1' },
    { nombre: 'Ana', email: 'ana@correo.cl', password: '123' },
    { nombre: 'Ana', email: 'ana@correo.cl', password: 'secreta1', extra: 1 },
    { nombre: {}, email: 'ana@correo.cl', password: 'secreta1' },
  ];

  for (const body of invalidos) {
    const response = await app.inject({ method: 'POST', url: '/api/vecinos/registro', payload: body });
    assert.equal(response.statusCode, 400, JSON.stringify(body));
    assert.match(response.json().error, /válidos/);
  }
});

test('POST /api/vecinos/login valida el cuerpo antes de consultar', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [{}, { email: 'x' }, { password: 'x' }, { email: 'a@b.cl', password: 'x', extra: 1 }];

  for (const body of invalidos) {
    const response = await app.inject({ method: 'POST', url: '/api/vecinos/login', payload: body });
    assert.equal(response.statusCode, 400, JSON.stringify(body));
  }
});

test('las rutas de la cuenta del vecino exigen sesión', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  for (const url of ['/api/vecinos/me', '/api/vecinos/pedidos']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, url);
    assert.match(response.json().error, /iniciar sesión/);
  }

  // Una cookie del vecino falsa tampoco da acceso.
  const conCookieFalsa = await app.inject({
    method: 'GET',
    url: '/api/vecinos/pedidos',
    headers: { cookie: 'farmacia_vecino=token-inexistente' },
  });
  assert.ok([401, 500].includes(conCookieFalsa.statusCode));
  assert.notEqual(conCookieFalsa.statusCode, 200);
});

test('POST /api/vecinos/logout responde 204 con o sin sesión', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  // Sin cookie el cierre es idempotente (el navegador lo llama al salir).
  const sinCookie = await app.inject({ method: 'POST', url: '/api/vecinos/logout' });
  assert.equal(sinCookie.statusCode, 204);

  // Una cookie inválida tampoco es un error de sesión: solo se limpia el
  // encabezado (500 si el entorno del test no tiene base disponible).
  const conCookieFalsa = await app.inject({
    method: 'POST',
    url: '/api/vecinos/logout',
    headers: { cookie: 'farmacia_vecino=token-inexistente' },
  });
  assert.ok([204, 500].includes(conCookieFalsa.statusCode));
  assert.notEqual(conCookieFalsa.statusCode, 401);
  if (conCookieFalsa.statusCode === 204) {
    assert.match(String(conCookieFalsa.headers['set-cookie']), /farmacia_vecino=;/);
  }
});

test('la sesión del panel y la del vecino usan cookies distintas', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  // La cookie del panel no se interpreta como sesión del vecino.
  const response = await app.inject({
    method: 'GET',
    url: '/api/vecinos/me',
    headers: { cookie: 'farmacia_sesion=token-cualquiera' },
  });
  assert.equal(response.statusCode, 401);
});

test('GET /api/pedidos/seguimiento valida número y contacto (HU-07)', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const invalidos = [
    '',
    '?numero=0&contacto=987654321',
    '?numero=abc&contacto=987654321',
    '?numero=12',
    '?contacto=987654321',
    '?numero=12&contacto=ab',
    '?numero=12&contacto=987654321&extra=1',
  ];

  for (const query of invalidos) {
    const response = await app.inject({ method: 'GET', url: `/api/pedidos/seguimiento${query}` });
    assert.equal(response.statusCode, 400, query || '(sin query)');
  }
});

test('GET /api/pedidos/seguimiento consulta real sin exponer otros pedidos', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/pedidos/seguimiento?numero=999999&contacto=987654321',
  });

  // 404 cuando la consulta corre; 500 si no hay BD disponible (nunca 200 ni 400).
  assert.ok([404, 500].includes(response.statusCode));
  assert.notEqual(response.statusCode, 400);
});
