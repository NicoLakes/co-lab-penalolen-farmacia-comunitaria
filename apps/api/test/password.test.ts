import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';

test('hashPassword genera un hash scrypt distinto de la contraseña', async () => {
  const hash = await hashPassword('secreta123');
  assert.match(hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(hash, 'secreta123');
});

test('verifyPassword confirma la contraseña correcta y rechaza la incorrecta', async () => {
  const hash = await hashPassword('secreta123');
  assert.equal(await verifyPassword('secreta123', hash), true);
  assert.equal(await verifyPassword('otra-clave', hash), false);
});

test('verifyPassword rechaza hashes malformados o de otro algoritmo', async () => {
  for (const almacenada of ['', 'plain:abc', 'scrypt:solo-salt', 'md5:aaa:bbb', 'scrypt::']) {
    assert.equal(await verifyPassword('secreta123', almacenada), false);
  }
});

test('dos hashes de la misma contraseña usan sales distintas', async () => {
  const [a, b] = await Promise.all([hashPassword('secreta123'), hashPassword('secreta123')]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('secreta123', b), true);
});
