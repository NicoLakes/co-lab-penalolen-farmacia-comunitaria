import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

test('la configuración por defecto escucha solo en localhost', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 3001 });
});

test('permite configurar el host y el puerto', () => {
  assert.deepEqual(readConfig({ HOST: '0.0.0.0', PORT: '8080' }), {
    host: '0.0.0.0', port: 8080,
  });
});

test('rechaza puertos inválidos y host vacío', () => {
  for (const port of ['', '0', '65536', '-1', '3.5', '3001abc', 'Infinity', ' 3001 ']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT/);
  }
  assert.throws(() => readConfig({ HOST: ' ' }), /HOST/);
});
