export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3001';

  if (!host.trim()) {
    throw new Error('HOST no puede estar vacío.');
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  return { host, port };
}
