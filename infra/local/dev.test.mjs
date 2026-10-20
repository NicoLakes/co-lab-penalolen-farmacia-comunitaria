import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, prepareEnvironment, selectPorts } from './dev.mjs';

const defaults = 'POSTGRES_USER=farmacia\nPOSTGRES_DB=farmacia\nPOSTGRES_PASSWORD=\nWEB_PORT=5173\nAPI_PORT=3001\nPOSTGRES_PORT=5432\n';
const ports = { WEB_PORT: '5173', API_PORT: '3001', POSTGRES_PORT: '5432' };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'farmacia-dev-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.env.example'), defaults);
  return directory;
}

test('el primer arranque genera un secreto persistente y un archivo privado', async (t) => {
  const directory = await fixture(t);
  const env = await prepareEnvironment(directory);
  assert.match(env.POSTGRES_PASSWORD, /^[0-9a-f]{64}$/);
  assert.equal(new URL(env.DATABASE_URL).hostname, 'postgres');
  assert.equal(new URL(env.DATABASE_URL).password, env.POSTGRES_PASSWORD);
  assert.deepEqual(await prepareEnvironment(directory), env);
  assert.equal((await stat(join(directory, '.env.local'))).mode & 0o777, 0o600);
});

test('conserva las credenciales anteriores para no romper un volumen existente', async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, 'packages/database'), { recursive: true });
  await writeFile(join(directory, 'packages/database/.env'), 'POSTGRES_PASSWORD=previous-test-value\nPOSTGRES_PORT=55432\n');
  const env = await prepareEnvironment(directory);
  assert.equal(env.POSTGRES_PASSWORD, 'previous-test-value');
  assert.equal(env.POSTGRES_PORT, '55432');
});

test('no sobrescribe configuración local y codifica caracteres especiales en la URL', async (t) => {
  const directory = await fixture(t);
  const content = "POSTGRES_PASSWORD='local test@value#'\nWEB_PORT=5180\n";
  await writeFile(join(directory, '.env.local'), content);
  const env = await prepareEnvironment(directory);
  assert.equal(env.WEB_PORT, '5180');
  assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).password), 'local test@value#');
  assert.equal(await readFile(join(directory, '.env.local'), 'utf8'), content);
});

test('rechaza configuración inválida sin incluir secretos en el error', async (t) => {
  const directory = await fixture(t);
  for (const content of ['POSTGRES_PASSWORD=\n', 'POSTGRES_PASSWORD=fixture\nWEB_PORT=0\n',
    'POSTGRES_PASSWORD=fixture\nAPI_PORT=65536\n', 'POSTGRES_PASSWORD=fixture\nPOSTGRES_USER=invalid-name\n']) {
    await writeFile(join(directory, '.env.local'), content);
    await assert.rejects(prepareEnvironment(directory), (error) => {
      assert.ok(!error.message.includes('fixture'));
      return true;
    });
  }
});

test('busca puertos libres cuando otro proyecto ocupa los preferidos', async () => {
  const occupied = new Set([5173, 3001, 5432]);
  const env = await selectPorts(ports, [], async (port) => !occupied.has(port));
  assert.deepEqual(env, { WEB_PORT: '5174', API_PORT: '3002', POSTGRES_PORT: '5433' });
});

test('reutiliza los puertos del proyecto en ejecución y evita duplicados', async () => {
  const containers = [{ Service: 'web', State: 'running', Publishers: [
    { URL: '127.0.0.1', TargetPort: 5173, PublishedPort: 5180, Protocol: 'tcp' },
  ] }];
  const env = await selectPorts({ ...ports, API_PORT: '5180' }, containers, async () => true);
  assert.equal(env.WEB_PORT, '5180');
  assert.equal(env.API_PORT, '5181');
});

test('falla con un mensaje útil si no encuentra puertos libres', async () => {
  await assert.rejects(selectPorts(ports, [], async () => false), /No hay puerto libre para web/);
});

test('rechaza modos desconocidos antes de consultar Docker o modificar servicios', async () => {
  await assert.rejects(main('unknown'), /Modo no válido/);
});
