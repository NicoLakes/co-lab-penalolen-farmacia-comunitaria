import type {
  FulfillmentMethod,
  OrderDeliveryDetails,
  OrderItemDetail,
  OrderStatus,
} from '../orders/orders.api';

export type StaffOrderStatusFilter = 'confirmed' | 'fulfilled';

export interface StaffOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  totalClp: string;
  reservationExpiresAt: string;
  createdAt: string;
  buyerEmail: string | null;
}

export interface StaffOrderDetail extends StaffOrderSummary {
  deliveryDetails: OrderDeliveryDetails | null;
  items: OrderItemDetail[];
}

export class StaffOrdersApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffOrdersApiError';
  }
}

const VALID_STATUSES: readonly OrderStatus[] = [
  'pending_payment',
  'confirmed',
  'fulfilled',
  'cancelled',
  'expired',
];

function isStaffOrderSummary(value: unknown): value is StaffOrderSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const buyerEmailValid = row.buyerEmail === undefined || row.buyerEmail === null || typeof row.buyerEmail === 'string';
  return (
    typeof row.id === 'string'
    && typeof row.orderNumber === 'string'
    && typeof row.status === 'string'
    && VALID_STATUSES.some((status) => status === row.status)
    && (row.fulfillmentMethod === 'pickup' || row.fulfillmentMethod === 'delivery')
    && typeof row.totalClp === 'string'
    && /^\d{1,19}$/.test(row.totalClp)
    && typeof row.reservationExpiresAt === 'string'
    && typeof row.createdAt === 'string'
    && buyerEmailValid
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

function isStaffOrderDetail(value: unknown): value is StaffOrderDetail {
  if (!isStaffOrderSummary(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  const deliveryValid = row.deliveryDetails === null || isDeliveryDetails(row.deliveryDetails);
  return deliveryValid && Array.isArray(row.items) && row.items.every(isOrderItemDetail);
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

function mapStaffOrderError(status: number, code: string, fallback: string): string {
  if (status === 401) return 'Tu sesión expiró. Inicia sesión nuevamente.';
  if (status === 403) return 'Tu cuenta no tiene permisos para gestionar entregas de pedidos.';
  if (status === 404) return 'No encontramos ese pedido en la cola de cumplimiento.';
  if (code === 'unavailable_product') {
    return 'Un lote o saldo asignado a este pedido dejó de ser elegible para entrega.';
  }
  if (status === 409) return 'El estado actual del pedido ya no permite marcarlo como entregado.';
  return fallback;
}

export async function listFulfillmentOrders(
  status: StaffOrderStatusFilter,
  signal?: AbortSignal,
): Promise<StaffOrderSummary[]> {
  const response = await fetch(
    `/api/fulfillment/orders?status=${encodeURIComponent(status)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffOrdersApiError(
      response.status,
      code,
      mapStaffOrderError(response.status, code, 'No pudimos cargar los pedidos.'),
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isStaffOrderSummary)) {
    throw new StaffOrdersApiError(502, 'invalid_response', 'La API devolvió un listado de pedidos inválido.');
  }
  return body.map((row) => ({ ...row, buyerEmail: row.buyerEmail ?? null }));
}

export async function getFulfillmentOrderDetail(
  orderId: string,
  signal?: AbortSignal,
): Promise<StaffOrderDetail> {
  const response = await fetch(
    `/api/fulfillment/orders/${encodeURIComponent(orderId)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffOrdersApiError(
      response.status,
      code,
      mapStaffOrderError(response.status, code, 'No pudimos cargar el detalle del pedido.'),
    );
  }
  const body: unknown = await response.json();
  if (!isStaffOrderDetail(body)) {
    throw new StaffOrdersApiError(502, 'invalid_response', 'La API devolvió un detalle de pedido inválido.');
  }
  return { ...body, buyerEmail: body.buyerEmail ?? null };
}

export async function fulfillStaffOrder(
  orderId: string,
  operationId: string,
): Promise<StaffOrderSummary> {
  const response = await fetch(`/api/fulfillment/orders/${encodeURIComponent(orderId)}/fulfill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new StaffOrdersApiError(
      response.status,
      code,
      mapStaffOrderError(response.status, code, 'No pudimos marcar el pedido como entregado.'),
    );
  }
  const body: unknown = await response.json();
  if (!isStaffOrderSummary(body)) {
    throw new StaffOrdersApiError(502, 'invalid_response', 'La API devolvió una respuesta inválida al entregar.');
  }
  return { ...body, buyerEmail: body.buyerEmail ?? null };
}

export type InPersonPaymentMethod = 'cash' | 'card' | 'bank_transfer';

export const IN_PERSON_PAYMENT_LABELS: Record<InPersonPaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank_transfer: 'Transferencia presencial',
};

export interface CreateInPersonOrderPayload {
  idempotencyKey: string;
  buyerEmail: string | null;
  paymentMethod: InPersonPaymentMethod;
  items: readonly { productId: string; quantity: number }[];
}

export async function createInPersonOrder(
  payload: CreateInPersonOrderPayload,
): Promise<StaffOrderSummary> {
  const response = await fetch('/api/fulfillment/orders/in-person', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    const customMessage = code === 'insufficient_stock'
      ? 'No hay stock disponible suficiente para alguno de los medicamentos seleccionados.'
      : code === 'not_found'
        ? 'No encontramos una cuenta registrada con ese correo de vecino (déjalo vacío si es venta sin cuenta).'
        : code === 'unavailable_product'
          ? 'Alguno de los productos no tiene precio ni condición de venta configurados.'
          : mapStaffOrderError(response.status, code, 'No pudimos registrar la venta presencial.');
    throw new StaffOrdersApiError(response.status, code, customMessage);
  }
  const body: unknown = await response.json();
  if (!isStaffOrderSummary(body)) {
    throw new StaffOrdersApiError(
      502,
      'invalid_response',
      'La API devolvió una respuesta inválida al registrar la venta presencial.',
    );
  }
  return { ...body, buyerEmail: body.buyerEmail ?? null };
}
