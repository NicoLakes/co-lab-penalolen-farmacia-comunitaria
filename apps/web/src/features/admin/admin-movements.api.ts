export type AuditMovementType =
  | 'opening'
  | 'receipt'
  | 'sale'
  | 'adjustment'
  | 'transfer_out'
  | 'transfer_in';

export interface AdminInventoryMovement {
  id: string;
  createdAt: string;
  movementType: AuditMovementType;
  quantityDelta: number;
  reason: string;
  actorReference: string;
  actorEmail: string | null;
  productCode: string;
  productName: string;
  locationName: string;
  lotNumber: string | null;
}

export class AdminMovementsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminMovementsApiError';
  }
}

export const MOVEMENT_TYPE_LABELS: Record<AuditMovementType, string> = {
  opening: 'Stock inicial',
  receipt: 'Ingreso',
  sale: 'Venta',
  adjustment: 'Ajuste',
  transfer_out: 'Traslado bodega (salida)',
  transfer_in: 'Traslado bodega (entrada)',
};

const VALID_TYPES: readonly AuditMovementType[] = [
  'opening',
  'receipt',
  'sale',
  'adjustment',
  'transfer_out',
  'transfer_in',
];

function isMovementItem(value: unknown): value is AdminInventoryMovement {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const validActorEmail = row.actorEmail === null || typeof row.actorEmail === 'string';
  const validLot = row.lotNumber === null || typeof row.lotNumber === 'string';
  return (
    typeof row.id === 'string'
    && typeof row.createdAt === 'string'
    && typeof row.movementType === 'string'
    && VALID_TYPES.some((type) => type === row.movementType)
    && typeof row.quantityDelta === 'number'
    && Number.isSafeInteger(row.quantityDelta)
    && row.quantityDelta !== 0
    && typeof row.reason === 'string'
    && typeof row.actorReference === 'string'
    && validActorEmail
    && typeof row.productCode === 'string'
    && typeof row.productName === 'string'
    && typeof row.locationName === 'string'
    && validLot
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

export async function listAdminInventoryMovements(
  filters: { query?: string; movementType?: AuditMovementType | '' } = {},
  signal?: AbortSignal,
): Promise<AdminInventoryMovement[]> {
  const params = new URLSearchParams();
  const trimmed = filters.query?.trim() ?? '';
  if (trimmed) params.set('q', trimmed);
  if (filters.movementType) params.set('movementType', filters.movementType);
  const url = params.size > 0
    ? `/api/admin/inventory-movements?${params.toString()}`
    : '/api/admin/inventory-movements';

  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    const code = await readErrorCode(response);
    const message = response.status === 401
      ? 'Tu sesión expiró. Inicia sesión nuevamente.'
      : response.status === 403
        ? 'No tienes permisos para consultar el historial de movimientos.'
        : 'No pudimos cargar el historial de movimientos de stock.';
    throw new AdminMovementsApiError(response.status, code, message);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isMovementItem)) {
    throw new AdminMovementsApiError(
      502,
      'invalid_response',
      'La API devolvió un historial de movimientos inválido.',
    );
  }
  return body;
}
