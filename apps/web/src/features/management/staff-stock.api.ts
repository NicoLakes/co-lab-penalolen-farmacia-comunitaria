export type SaleCondition =
  | 'direct_sale'
  | 'simple_prescription'
  | 'retained_prescription'
  | 'retained_prescription_stock_control'
  | 'prescription_cheque'
  | 'not_applicable';

export interface StaffStockItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  quantityUnit: string;
  activeIngredient: string | null;
  dosageForm: string | null;
  presentation: string | null;
  supplier: string | null;
  therapeuticCategory: string | null;
  priceClp: number | null;
  saleCondition: SaleCondition | null;
  isPublished: boolean;
  inventoryTracking: 'quantity_only' | 'lot_and_expiration' | null;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export interface CreateStaffProductPayload {
  code: string;
  name: string;
  description: string | null;
  quantityUnit: string;
  activeIngredient: string | null;
  dosageForm: string | null;
  presentation: string | null;
  supplierName: string | null;
  therapeuticCategoryName: string | null;
  priceClp: number | null;
  saleCondition: SaleCondition | null;
  isPublished: boolean;
  initialStock: number;
  operationId: string;
}

export interface UpdateStaffProductPayload {
  name?: string | undefined;
  description?: string | null | undefined;
  activeIngredient?: string | null | undefined;
  dosageForm?: string | null | undefined;
  presentation?: string | null | undefined;
  supplierName?: string | null | undefined;
  therapeuticCategoryName?: string | null | undefined;
  priceClp?: number | null | undefined;
  saleCondition?: SaleCondition | null | undefined;
  isPublished?: boolean | undefined;
}

export interface AdjustStaffStockPayload {
  operationId: string;
  quantityDelta: number;
  reason: string;
  movementType: 'receipt' | 'adjustment';
}

export class StaffStockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffStockApiError';
  }
}

export const SALE_CONDITION_LABELS: Record<SaleCondition, string> = {
  direct_sale: 'Venta directa',
  simple_prescription: 'Receta simple',
  retained_prescription: 'Receta retenida',
  retained_prescription_stock_control: 'Receta retenida (control stock)',
  prescription_cheque: 'Receta cheque',
  not_applicable: 'No aplica (insumo)',
};

const VALID_CONDITIONS: readonly SaleCondition[] = [
  'direct_sale',
  'simple_prescription',
  'retained_prescription',
  'retained_prescription_stock_control',
  'prescription_cheque',
  'not_applicable',
];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonnegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStaffStockItem(value: unknown): value is StaffStockItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const validCondition = row.saleCondition === null
    || (typeof row.saleCondition === 'string' && VALID_CONDITIONS.some((c) => c === row.saleCondition));
  const validPrice = row.priceClp === null
    || (typeof row.priceClp === 'number' && Number.isSafeInteger(row.priceClp) && row.priceClp > 0);
  const validTracking = row.inventoryTracking === null
    || row.inventoryTracking === 'quantity_only'
    || row.inventoryTracking === 'lot_and_expiration';

  return (
    typeof row.id === 'string'
    && typeof row.code === 'string'
    && typeof row.name === 'string'
    && isNullableString(row.description)
    && typeof row.quantityUnit === 'string'
    && isNullableString(row.activeIngredient)
    && isNullableString(row.dosageForm)
    && isNullableString(row.presentation)
    && isNullableString(row.supplier)
    && isNullableString(row.therapeuticCategory)
    && validPrice
    && validCondition
    && typeof row.isPublished === 'boolean'
    && validTracking
    && isNonnegativeInt(row.onHandQuantity)
    && isNonnegativeInt(row.reservedQuantity)
    && isNonnegativeInt(row.availableQuantity)
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

function mapStockError(status: number, code: string, fallback: string): string {
  if (status === 401) return 'Tu sesión expiró. Inicia sesión nuevamente.';
  if (status === 403) return 'Tu cuenta no tiene permisos de gestión de stock.';
  if (status === 404) return 'No encontramos el producto solicitado.';
  if (code === 'duplicate_code') return 'Ya existe un producto con ese código.';
  if (code === 'product_has_history') {
    return 'Este producto tiene movimientos o pedidos registrados y no se puede eliminar. Puedes ocultarlo del catálogo.';
  }
  if (code === 'insufficient_stock') {
    return 'No puedes reducir el stock por debajo de las unidades actualmente reservadas.';
  }
  if (code === 'unsupported_tracking') {
    return 'Este producto usa seguimiento por lote y vencimiento; requiere un flujo por lote.';
  }
  if (code === 'no_active_location') {
    return 'No hay una bodega activa configurada para registrar stock.';
  }
  if (status === 400) {
    return 'Revisa los datos ingresados (para publicar un producto necesitas precio CLP mayor a 0 y condición de venta).';
  }
  return fallback;
}

export async function listStaffStock(signal?: AbortSignal): Promise<StaffStockItem[]> {
  const response = await fetch('/api/staff/stock', signal ? { signal } : undefined);
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffStockApiError(
      response.status,
      code,
      mapStockError(response.status, code, 'No pudimos cargar el inventario.'),
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isStaffStockItem)) {
    throw new StaffStockApiError(502, 'invalid_response', 'La API devolvió un listado de stock inválido.');
  }
  return body;
}

export async function createStaffProduct(payload: CreateStaffProductPayload): Promise<StaffStockItem> {
  const response = await fetch('/api/staff/stock/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffStockApiError(
      response.status,
      code,
      mapStockError(response.status, code, 'No pudimos crear el producto.'),
    );
  }
  const body: unknown = await response.json();
  if (!isStaffStockItem(body)) {
    throw new StaffStockApiError(502, 'invalid_response', 'La API devolvió un producto inválido al crearlo.');
  }
  return body;
}

export async function updateStaffProduct(
  productId: string,
  payload: UpdateStaffProductPayload,
): Promise<StaffStockItem> {
  const response = await fetch(`/api/staff/stock/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffStockApiError(
      response.status,
      code,
      mapStockError(response.status, code, 'No pudimos actualizar el producto.'),
    );
  }
  const body: unknown = await response.json();
  if (!isStaffStockItem(body)) {
    throw new StaffStockApiError(502, 'invalid_response', 'La API devolvió un producto inválido al actualizarlo.');
  }
  return body;
}

export async function adjustStaffProductStock(
  productId: string,
  payload: AdjustStaffStockPayload,
): Promise<StaffStockItem> {
  const response = await fetch(`/api/staff/stock/products/${encodeURIComponent(productId)}/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffStockApiError(
      response.status,
      code,
      mapStockError(response.status, code, 'No pudimos actualizar el stock del producto.'),
    );
  }
  const body: unknown = await response.json();
  if (!isStaffStockItem(body)) {
    throw new StaffStockApiError(502, 'invalid_response', 'La API devolvió un saldo inválido al ajustar stock.');
  }
  return body;
}

export async function deleteStaffProduct(productId: string): Promise<void> {
  const response = await fetch(`/api/staff/stock/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffStockApiError(
      response.status,
      code,
      mapStockError(response.status, code, 'No pudimos eliminar el producto.'),
    );
  }
}
