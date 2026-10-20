import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase, schema } from '../src/index.js';
import { validateDatabaseUrl } from '../src/config.js';

const connectionString = 'postgresql://localhost/farmacia_test';

test('acepta las dos formas de URL PostgreSQL y conserva los parámetros TLS', () => {
  for (const url of [connectionString, 'postgres://localhost/farmacia_test?sslmode=verify-full']) {
    assert.equal(validateDatabaseUrl(url), url);
  }
});

test('rechaza configuración ausente o inválida sin exponer credenciales', () => {
  for (const value of [undefined, '', 'invalid', 'https://localhost/farmacia', 'postgres://localhost',
    'postgres:///farmacia', 'postgres://localhost/farmacia#fragment', 'postgres://localhost:99999/db']) {
    assert.throws(() => validateDatabaseUrl(value), /DATABASE_URL/);
  }

  const sensitiveUrl = 'https://user:private-test-value@localhost/db';
  assert.throws(() => validateDatabaseUrl(sensitiveUrl), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('private-test-value'));
    return true;
  });
});

test('crea pools independientes sin conectar durante la construcción', async (t) => {
  const onPoolError = (error: Error) => { throw error; };
  const first = createDatabase({ connectionString, onPoolError });
  const second = createDatabase({ connectionString, onPoolError });
  t.after(async () => { await Promise.all([first.pool.end(), second.pool.end()]); });

  assert.notEqual(first.pool, second.pool);
  assert.equal(first.pool.totalCount, 0);
  assert.equal(second.pool.totalCount, 0);
  assert.equal(first.pool.options.max, 10);
  assert.equal(first.pool.options.connectionTimeoutMillis, 5000);
  assert.ok(first.db);
  assert.deepEqual(Object.keys(schema), []);
});

test('entrega los errores de conexiones inactivas al consumidor', async (t) => {
  const errors: Error[] = [];
  const { pool } = createDatabase({ connectionString, onPoolError: (error) => errors.push(error) });
  t.after(() => pool.end());

  const error = new Error('Conexión interrumpida');
  pool.emit('error', error);

  assert.deepEqual(errors, [error]);
});
