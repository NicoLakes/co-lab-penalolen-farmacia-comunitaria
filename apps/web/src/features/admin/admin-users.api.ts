export type ManagedRole = 'buyer' | 'pharmacy_operator' | 'user_admin';
export type UserAccountStatus = 'active' | 'disabled';

export interface ManagedUser {
  id: string;
  email: string;
  status: UserAccountStatus;
  roles: ManagedRole[];
  createdAt?: string;
}

export class AdminUsersApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminUsersApiError';
  }
}

const VALID_ROLES: readonly ManagedRole[] = ['buyer', 'pharmacy_operator', 'user_admin'];

function isManagedRole(value: unknown): value is ManagedRole {
  return typeof value === 'string' && VALID_ROLES.some((role) => role === value);
}

function isManagedUser(value: unknown): value is ManagedUser {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string'
    && typeof row.email === 'string'
    && (row.status === 'active' || row.status === 'disabled')
    && Array.isArray(row.roles)
    && row.roles.every(isManagedRole)
    && (row.createdAt === undefined || typeof row.createdAt === 'string')
  );
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
      return body.code;
    }
  } catch {
    // Ignore non-JSON error responses.
  }
  return 'request_failed';
}

function mapErrorMessage(status: number, code: string, fallback: string): string {
  if (status === 401) return 'Tu sesión expiró. Inicia sesión nuevamente.';
  if (status === 403) return 'No tienes permisos para realizar esta acción sobre esa cuenta.';
  if (status === 404) return 'No encontramos una cuenta verificada con ese correo.';
  if (status === 409 && code === 'email_already_exists') {
    return 'Ya existe una cuenta registrada con ese correo electrónico.';
  }
  if (status === 409) return 'No se puede asignar un rol a una cuenta deshabilitada.';
  return fallback;
}

export async function listManagedUsers(query = '', signal?: AbortSignal): Promise<ManagedUser[]> {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  const url = params.size > 0 ? `/api/admin/users?${params.toString()}` : '/api/admin/users';
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new AdminUsersApiError(
      response.status,
      code,
      mapErrorMessage(response.status, code, 'No pudimos cargar el listado de usuarios.'),
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isManagedUser)) {
    throw new AdminUsersApiError(502, 'invalid_response', 'La API devolvió un listado de usuarios inválido.');
  }
  return body;
}

export async function createManagedUser(email: string, roles: readonly ManagedRole[]): Promise<ManagedUser> {
  const response = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), roles: [...new Set(roles)] }),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new AdminUsersApiError(
      response.status,
      code,
      mapErrorMessage(response.status, code, 'No pudimos crear la cuenta.'),
    );
  }
  const body: unknown = await response.json();
  if (!isManagedUser(body)) {
    throw new AdminUsersApiError(502, 'invalid_response', 'La API devolvió una cuenta inválida al crearla.');
  }
  return body;
}

export async function setManagedUserRole(
  userId: string,
  role: ManagedRole,
  grant: boolean,
): Promise<void> {
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
    { method: grant ? 'PUT' : 'DELETE' },
  );
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new AdminUsersApiError(
      response.status,
      code,
      mapErrorMessage(response.status, code, 'No pudimos actualizar el rol del usuario.'),
    );
  }
}

export async function setManagedUserStatus(
  userId: string,
  status: UserAccountStatus,
): Promise<void> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new AdminUsersApiError(
      response.status,
      code,
      mapErrorMessage(response.status, code, 'No pudimos actualizar el estado de la cuenta.'),
    );
  }
}
