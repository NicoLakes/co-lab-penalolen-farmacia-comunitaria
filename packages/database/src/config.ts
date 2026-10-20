export function validateDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('DATABASE_URL es obligatoria para conectar con PostgreSQL.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1 ||
    url.hash
  ) {
    throw new Error('DATABASE_URL debe indicar un host y una base de datos PostgreSQL, sin fragmentos.');
  }

  return value;
}
