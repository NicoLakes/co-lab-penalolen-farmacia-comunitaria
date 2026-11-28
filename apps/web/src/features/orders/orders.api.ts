export type OrderStatus =
  | 'pending_review'
  | 'pending_payment'
  | 'confirmed'
  | 'fulfilled'
  | 'cancelled'
  | 'expired'
  | 'rejected';

export type FulfillmentMethod = 'pickup' | 'delivery';

export type PrescriptionReviewStatus = 'pending' | 'approved' | 'rejected';

export const MAX_PRESCRIPTION_BYTES = 5 * 1024 * 1024;

export const ALLOWED_PRESCRIPTION_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPrescriptionMimeType = (typeof ALLOWED_PRESCRIPTION_MIME_TYPES)[number];

export interface PrescriptionSummary {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: PrescriptionReviewStatus;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  totalClp: string;
  reservationExpiresAt: string | null;
  createdAt: string;
}

export interface OrderDeliveryDetails {
  recipientName: string;
  phone: string;
  address: string;
  commune: string;
}

export interface OrderItemDetail {
  productId: string;
  name: string;
  quantity: number;
  quantityUnit: string;
  unitPriceClp: number;
}

export interface OrderDetail extends OrderSummary {
  deliveryDetails: OrderDeliveryDetails | null;
  items: OrderItemDetail[];
  prescription?: PrescriptionSummary | null;
}

export interface CreatePrescriptionOrderInput {
  idempotencyKey: string;
  items: readonly { productId: string; quantity: number }[];
  fulfillment:
    | { method: 'pickup' }
    | { method: 'delivery'; details: OrderDeliveryDetails };
  prescription: {
    fileName: string;
    mimeType: AllowedPrescriptionMimeType;
    contentBase64: string;
  };
}

export interface CreatedPrescriptionOrder extends OrderSummary {
  prescription: PrescriptionSummary;
}

export class OrdersApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly productNames?: readonly string[],
  ) {
    super(message);
    this.name = 'OrdersApiError';
  }
}

export const VALID_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending_review',
  'pending_payment',
  'confirmed',
  'fulfilled',
  'cancelled',
  'expired',
  'rejected',
];

const VALID_PRESCRIPTION_STATUSES: readonly PrescriptionReviewStatus[] = [
  'pending',
  'approved',
  'rejected',
];

export function isPrescriptionSummary(value: unknown): value is PrescriptionSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string'
    && typeof row.fileName === 'string'
    && typeof row.mimeType === 'string'
    && typeof row.fileSizeBytes === 'number'
    && Number.isSafeInteger(row.fileSizeBytes)
    && row.fileSizeBytes > 0
    && typeof row.status === 'string'
    && VALID_PRESCRIPTION_STATUSES.some((status) => status === row.status)
    && (row.reviewedAt === null || typeof row.reviewedAt === 'string')
    && (row.rejectionReason === null || typeof row.rejectionReason === 'string')
    && typeof row.createdAt === 'string'
  );
}

function isOrderSummary(value: unknown): value is OrderSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string'
    && typeof row.orderNumber === 'string'
    && typeof row.status === 'string'
    && VALID_ORDER_STATUSES.some((status) => status === row.status)
    && (row.fulfillmentMethod === 'pickup' || row.fulfillmentMethod === 'delivery')
    && typeof row.totalClp === 'string'
    && /^\d{1,19}$/.test(row.totalClp)
    && (row.reservationExpiresAt === null || typeof row.reservationExpiresAt === 'string')
    && typeof row.createdAt === 'string'
  );
}

function isDeliveryDetails(value: unknown): value is OrderDeliveryDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Record<string, unknown>;
  return (
    typeof details.recipientName === 'string'
    && typeof details.phone === 'string'
    && typeof details.address === 'string'
    && typeof details.commune === 'string'
  );
}

function isOrderItemDetail(value: unknown): value is OrderItemDetail {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === 'string'
    && typeof item.name === 'string'
    && typeof item.quantity === 'number'
    && Number.isSafeInteger(item.quantity)
    && item.quantity > 0
    && typeof item.quantityUnit === 'string'
    && typeof item.unitPriceClp === 'number'
    && Number.isSafeInteger(item.unitPriceClp)
    && item.unitPriceClp > 0
  );
}

function isOrderDetail(value: unknown): value is OrderDetail {
  if (!isOrderSummary(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  const deliveryValid = row.deliveryDetails === null || isDeliveryDetails(row.deliveryDetails);
  const itemsValid = Array.isArray(row.items) && row.items.every(isOrderItemDetail);
  const prescriptionValid =
    row.prescription === undefined || row.prescription === null || isPrescriptionSummary(row.prescription);
  return deliveryValid && itemsValid && prescriptionValid;
}

function extractProductNames(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== 'object' || !('productNames' in payload)) return undefined;
  const raw = (payload as Record<string, unknown>).productNames;
  if (!Array.isArray(raw)) return undefined;
  const names = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return names.length > 0 ? names : undefined;
}

function mapErrorMessage(status: number, code: string, productNames?: readonly string[]): string {
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión para ver tus pedidos.';
  if (status === 403) return 'Tu cuenta aún no tiene permisos de compra habilitados.';
  if (status === 404) return 'No encontramos el pedido solicitado.';
  if (status === 409) {
    if (code === 'insufficient_stock') {
      if (productNames && productNames.length > 0) {
        return `No pudimos confirmar tu solicitud porque se agotó o redujo el stock de: ${productNames.join(', ')}. Actualizamos el catálogo para que ajustes tu carrito.`;
      }
      return 'No hay stock suficiente para completar uno de los medicamentos seleccionados. Actualizamos el catálogo para que revises las cantidades.';
    }
    if (code === 'unavailable_product') {
      return 'Uno de los medicamentos seleccionados ya no está disponible para compra en línea.';
    }
    if (code === 'expired') {
      return 'El plazo de reserva de este pedido ya venció. Crea una nueva solicitud desde el catálogo.';
    }
    return 'Este pedido ya cambió de estado y no permite realizar esa acción.';
  }
  if (status === 400 || code === 'invalid_input') {
    return 'El archivo de receta o los datos del pedido no son válidos. Usa un archivo PDF, JPG, PNG o WEBP de hasta 5 MB.';
  }
  return 'Ocurrió un problema al consultar tus pedidos. Inténtalo nuevamente.';
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
        ? payload.code
        : 'request_failed';
    const productNames = extractProductNames(payload);
    throw new OrdersApiError(response.status, code, mapErrorMessage(response.status, code, productNames), productNames);
  }
  return payload;
}

export function myPrescriptionDownloadUrl(orderId: string): string {
  return `/api/orders/${encodeURIComponent(orderId)}/prescription`;
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function createPrescriptionOrder(
  input: CreatePrescriptionOrderInput,
): Promise<CreatedPrescriptionOrder> {
  const response = await fetch('/api/orders/prescription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  if (
    !isOrderSummary(payload)
    || !('prescription' in payload)
    || !isPrescriptionSummary((payload as Record<string, unknown>).prescription)
  ) {
    throw new OrdersApiError(500, 'invalid_response', 'La respuesta al registrar el pedido con receta no es válida.');
  }
  return payload as CreatedPrescriptionOrder;
}

export async function listMyOrders(signal?: AbortSignal): Promise<OrderSummary[]> {
  const response = await fetch('/api/orders', signal ? { signal } : undefined);
  const payload = await parseJsonOrThrow(response);
  if (!Array.isArray(payload) || !payload.every(isOrderSummary)) {
    throw new OrdersApiError(500, 'invalid_response', 'La respuesta del servidor de pedidos no es válida.');
  }
  return payload;
}

export async function getMyOrderDetail(orderId: string, signal?: AbortSignal): Promise<OrderDetail> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, signal ? { signal } : undefined);
  const payload = await parseJsonOrThrow(response);
  if (!isOrderDetail(payload)) {
    throw new OrdersApiError(500, 'invalid_response', 'El detalle del pedido recibido no es válido.');
  }
  return payload;
}

export async function cancelMyOrder(orderId: string, operationId: string): Promise<OrderSummary> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const payload = await parseJsonOrThrow(response);
  if (!isOrderSummary(payload)) {
    throw new OrdersApiError(500, 'invalid_response', 'La respuesta al cancelar el pedido no es válida.');
  }
  return payload;
}

// Temporary direct-confirmation call until Webpay Oneclick authorization replaces this step.
export async function payMyOrder(orderId: string, operationId: string): Promise<OrderSummary> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const payload = await parseJsonOrThrow(response);
  if (!isOrderSummary(payload)) {
    throw new OrdersApiError(500, 'invalid_response', 'La respuesta al confirmar el pago no es válida.');
  }
  return payload;
}
