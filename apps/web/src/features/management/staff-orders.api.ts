import {
  isPrescriptionSummary,
  VALID_ORDER_STATUSES,
} from '../orders/orders.api';
import type {
  FulfillmentMethod,
  OrderDeliveryDetails,
  OrderItemDetail,
  OrderStatus,
  PrescriptionSummary,
} from '../orders/orders.api';

export type StaffOrderStatusFilter = 'pending_review' | 'confirmed' | 'fulfilled' | 'rejected';
export type StaffOrderSort = 'newest' | 'oldest';

export interface StaffOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  totalClp: string;
  reservationExpiresAt: string | null;
  createdAt: string;
  buyerEmail: string | null;
}

export interface StaffOrderDetail extends StaffOrderSummary {
  deliveryDetails: OrderDeliveryDetails | null;
  items: OrderItemDetail[];
  prescription?: PrescriptionSummary | null;
}

export interface StaffPrescriptionReviewResult extends StaffOrderSummary {
  prescription: PrescriptionSummary;
  notificationSent: boolean;
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

function isStaffOrderSummary(value: unknown): value is StaffOrderSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const buyerEmailValid = row.buyerEmail === undefined || row.buyerEmail === null || typeof row.buyerEmail === 'string';
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
  const prescriptionValid =
    row.prescription === undefined || row.prescription === null || isPrescriptionSummary(row.prescription);
  return (
    (row.deliveryDetails === null || isDeliveryDetails(row.deliveryDetails))
    && Array.isArray(row.items)
    && row.items.every(isOrderItemDetail)
    && prescriptionValid
  );
}

function isReviewResult(value: unknown): value is StaffPrescriptionReviewResult {
  if (!isStaffOrderSummary(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  return isPrescriptionSummary(row.prescription) && typeof row.notificationSent === 'boolean';
}

function mapErrorMessage(status: number, code: string): string {
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión para gestionar pedidos.';
  if (status === 403) return 'Tu cuenta no tiene permisos de funcionario para gestionar pedidos.';
  if (status === 404) {
    return 'No encontramos el pedido o el correo indicado no tiene cuenta registrada.';
  }
  if (status === 400 || code === 'invalid_input') {
    return 'Revisa los datos ingresados antes de confirmar la operación.';
  }
  if (status === 409) {
    if (code === 'insufficient_stock') {
      return 'No hay stock suficiente para completar la venta con las cantidades ingresadas.';
    }
    if (code === 'unavailable_product') {
      return 'Al menos uno de los productos o lotes ya no está habilitado para entrega.';
    }
    return 'Este pedido ya cambió de estado y no puede procesarse de nuevo.';
  }
  return 'No pudimos completar la operación de pedidos. Inténtalo de nuevo.';
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
        ? payload.code
        : 'request_failed';
    throw new StaffOrdersApiError(response.status, code, mapErrorMessage(response.status, code));
  }
  return payload;
}

export type InPersonPaymentMethod = 'cash' | 'card' | 'bank_transfer';

export const IN_PERSON_PAYMENT_LABELS: Record<InPersonPaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta presencial',
  bank_transfer: 'Transferencia presencial',
};

export interface CreateInPersonOrderPayload {
  idempotencyKey: string;
  buyerEmail?: string | null;
  paymentMethod: InPersonPaymentMethod;
  items: { productId: string; quantity: number }[];
}

export function staffPrescriptionDownloadUrl(orderId: string): string {
  return `/api/fulfillment/orders/${encodeURIComponent(orderId)}/prescription`;
}

export async function listFulfillmentOrders(
  status: StaffOrderStatusFilter,
  signal?: AbortSignal,
  filters?: { sort?: StaffOrderSort | undefined; method?: FulfillmentMethod | undefined },
): Promise<StaffOrderSummary[]> {
  const params = new URLSearchParams({ status });
  if (filters?.sort) params.set('sort', filters.sort);
  if (filters?.method) params.set('method', filters.method);
  const response = await fetch(`/api/fulfillment/orders?${params.toString()}`, signal ? { signal } : undefined);
  const payload = await parseJsonOrThrow(response);
  if (!Array.isArray(payload) || !payload.every(isStaffOrderSummary)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'La lista de pedidos recibida no es válida.');
  }
  return payload;
}

export async function getFulfillmentOrderDetail(
  orderId: string,
  signal?: AbortSignal,
): Promise<StaffOrderDetail> {
  const response = await fetch(
    `/api/fulfillment/orders/${encodeURIComponent(orderId)}`,
    signal ? { signal } : undefined,
  );
  const payload = await parseJsonOrThrow(response);
  if (!isStaffOrderDetail(payload)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'El detalle del pedido recibido no es válido.');
  }
  return payload;
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
  const payload = await parseJsonOrThrow(response);
  if (!isStaffOrderSummary(payload)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'La respuesta al entregar el pedido no es válida.');
  }
  return { ...payload, buyerEmail: payload.buyerEmail ?? null };
}

export async function approveStaffPrescription(
  orderId: string,
  operationId: string,
): Promise<StaffPrescriptionReviewResult> {
  const response = await fetch(`/api/fulfillment/orders/${encodeURIComponent(orderId)}/approve-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const payload = await parseJsonOrThrow(response);
  if (!isReviewResult(payload)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'La respuesta al aprobar la receta no es válida.');
  }
  return { ...payload, buyerEmail: payload.buyerEmail ?? null };
}

export async function rejectStaffPrescription(
  orderId: string,
  operationId: string,
  reason: string,
): Promise<StaffPrescriptionReviewResult> {
  const response = await fetch(`/api/fulfillment/orders/${encodeURIComponent(orderId)}/reject-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId, reason }),
  });
  const payload = await parseJsonOrThrow(response);
  if (!isReviewResult(payload)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'La respuesta al rechazar la receta no es válida.');
  }
  return { ...payload, buyerEmail: payload.buyerEmail ?? null };
}

export async function createInPersonOrder(
  input: CreateInPersonOrderPayload,
): Promise<StaffOrderSummary> {
  const response = await fetch('/api/fulfillment/orders/in-person', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await parseJsonOrThrow(response);
  if (!isStaffOrderSummary(payload)) {
    throw new StaffOrdersApiError(500, 'invalid_response', 'La respuesta al registrar la venta presencial no es válida.');
  }
  return { ...payload, buyerEmail: payload.buyerEmail ?? null };
}
