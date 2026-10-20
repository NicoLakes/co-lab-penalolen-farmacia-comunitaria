import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const services = { WEB_PORT: ['web', 5173], API_PORT: ['api', 3001], POSTGRES_PORT: ['postgres', 5432] };

async function readEnvironment(path) {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function prepareEnvironment(directory = root) {
  const path = resolve(directory, '.env.local');
  const defaults = await readEnvironment(resolve(directory, '.env.example'));
  // Reutilizar la configuración anterior evita cambiar las credenciales de un volumen existente.
  const previous = await readEnvironment(resolve(directory, 'packages/database/.env'));
  const initial = {
    ...defaults,
    ...Object.fromEntries(['POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PORT', 'POSTGRES_PASSWORD']
      .filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]])),
  };
  initial.POSTGRES_PASSWORD ||= randomBytes(32).toString('hex');
  const content = Object.entries(initial).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  const roundTrip = parseEnv(content);
  if (Object.entries(initial).some(([key, value]) => roundTrip[key] !== value)) {
    throw new Error('La configuración anterior no se puede guardar de forma segura en .env.local; revisa sus caracteres de comillas.');
  }
  try {
    await writeFile(path, content, {
      flag: 'wx', mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const env = { ...defaults, ...await readEnvironment(path) };
  if (!env.POSTGRES_PASSWORD || env.POSTGRES_PASSWORD === 'REEMPLAZAR_CON_UN_SECRETO_LOCAL' || /[\r\n\0]/.test(env.POSTGRES_PASSWORD)) {
    throw new Error('Configura una contraseña local real en POSTGRES_PASSWORD de .env.local.');
  }
  for (const key of ['POSTGRES_USER', 'POSTGRES_DB']) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(env[key] ?? '')) {
      throw new Error(`Configura ${key} con letras minúsculas, números o guiones bajos en .env.local.`);
    }
  }
  for (const key of Object.keys(services)) {
    if (!/^[1-9]\d{0,4}$/.test(env[key] ?? '') || Number(env[key]) > 65535) {
      throw new Error(`Configura ${key} entre 1 y 65535 en .env.local.`);
    }
  }
  env.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${encodeURIComponent(env.POSTGRES_DB)}`;
  return env;
}

export async function portAvailable(port) {
  const listening = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(new Error('No se pudo comprobar un puerto local.'));
    });
  });
  if (listening) return false;
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(new Error('No se pudo comprobar un puerto local.'));
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function selectPorts(env, containers, available = portAvailable) {
  const selected = { ...env };
  const used = new Set();
  for (const [key, [service, target]] of Object.entries(services)) {
    const existing = containers.filter((container) => container.Service === service && container.State === 'running')
      .flatMap((container) => container.Publishers ?? [])
      .find((port) => port.TargetPort === target && port.URL === '127.0.0.1' && port.Protocol === 'tcp');
    let port = existing?.PublishedPort;
    if (!port || used.has(port)) {
      const preferred = Number(env[key]);
      port = preferred;
      while (port <= Math.min(preferred + 99, 65535) && (used.has(port) || !await available(port))) port++;
      if (port > Math.min(preferred + 99, 65535)) {
        throw new Error(`No hay puerto libre para ${service}; cambia ${key} en .env.local.`);
      }
    }
    selected[key] = String(port);
    used.add(port);
  }
  return selected;
}

function readDocker(args, env) {
  try {
    return execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error('No se pudo consultar Docker. Comprueba que Docker Desktop esté activo.');
  }
}

export async function main(mode = 'dev') {
  if (!['dev', 'down', 'config', 'logs', 'database', 'migrate', 'generate', 'test'].includes(mode)) {
    throw new Error('Modo no válido. Usa los comandos dev, dev:down, dev:config, dev:logs o db:* de pnpm.');
  }
  let env = { ...process.env, ...await prepareEnvironment() };
  const endpoint = env.DOCKER_CONTEXT || !env.DOCKER_HOST
    ? readDocker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], env)
    : env.DOCKER_HOST;
  if (!/^(unix|npipe):\/\//.test(endpoint)) throw new Error('Este comando requiere un Docker local.');
  const compose = ['compose', '--ansi', 'never', '--progress', 'plain', '--env-file', '.env.local', '-f', 'compose.development.yaml'];
  if (!['down', 'logs', 'config'].includes(mode)) {
    const output = readDocker([...compose, 'ps', '--all', '--format', 'json'], env);
    const containers = output.startsWith('[') ? JSON.parse(output) : output.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    env = await selectPorts(env, containers);
  }
  let args;
  if (mode === 'dev') {
    console.log(`\nFarmacia Comunitaria\n\n  Web: http://127.0.0.1:${env.WEB_PORT}\n  API: http://127.0.0.1:${env.API_PORT}/api/health\n  PostgreSQL: 127.0.0.1:${env.POSTGRES_PORT}\n`);
    args = ['up', '--build', '--watch', '--menu=false'];
  } else if (mode === 'database') args = ['up', '-d', '--wait', 'postgres'];
  else if (mode === 'down') args = ['down'];
  else if (mode === 'logs') args = ['logs', '--tail=100', '--follow'];
  else if (mode === 'config') args = ['config', '--quiet'];
  else if (mode === 'migrate') args = ['run', '--build', '--rm', 'migrate'];
  else if (mode === 'test') args = ['run', '--build', '--rm', 'migrate', 'pnpm', '--filter', '@farmacia/database', 'test:integration'];
  else {
    args = ['run', '--build', '--rm', '--no-deps',
      '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--volume', `${resolve(root, 'packages/database/src')}:/workspace/packages/database/src:ro`,
      '--volume', `${resolve(root, 'packages/database/migrations')}:/workspace/packages/database/migrations`,
      'migrate', 'pnpm', '--filter', '@farmacia/database', 'db:generate'];
  }
  const child = spawn('docker', [...compose, ...args], { cwd: root, env, stdio: 'inherit', detached: true });
  let interrupted = false;
  const forward = (signal) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const interrupt = () => { interrupted = true; forward('SIGINT'); };
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(interrupted && (code === 130 || signal === 'SIGINT') ? 0 : code ?? 1));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
