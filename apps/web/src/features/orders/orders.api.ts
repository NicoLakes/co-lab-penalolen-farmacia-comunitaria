export type OrderStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'fulfilled'
  | 'cancelled'
  | 'expired';

export type FulfillmentMethod = 'pickup' | 'delivery';

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentMethod: FulfillmentMethod;
  totalClp: string;
  reservationExpiresAt: string;
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
}

export class OrdersApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OrdersApiError';
  }
}

const VALID_STATUSES: readonly OrderStatus[] = [
  'pending_payment',
  'confirmed',
  'fulfilled',
  'cancelled',
  'expired',
];

function isOrderSummary(value: unknown): value is OrderSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
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
  return deliveryValid && Array.isArray(row.items) && row.items.every(isOrderItemDetail);
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
      return body.code;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return 'request_failed';
}

function mapStatusMessage(status: number, code: string, fallback: string): string {
  if (status === 401) return 'Tu sesión expiró. Inicia sesión nuevamente para ver tus pedidos.';
  if (status === 403) return 'Tu cuenta no tiene permisos habilitados para consultar pedidos.';
  if (status === 404) return 'No encontramos ese pedido.';
  if (status === 409 && code === 'expired') {
    return 'El plazo de reserva de esta solicitud venció. Crea una nueva solicitud desde el catálogo.';
  }
  if (status === 409) return 'El estado actual del pedido ya no permite esta acción.';
  return fallback;
}

export async function listMyOrders(signal?: AbortSignal): Promise<OrderSummary[]> {
  const response = await fetch('/api/orders', signal ? { signal } : undefined);
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new OrdersApiError(
      response.status,
      code,
      mapStatusMessage(response.status, code, 'No pudimos cargar tus pedidos. Inténtalo de nuevo.'),
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every(isOrderSummary)) {
    throw new OrdersApiError(502, 'invalid_response', 'La API devolvió un listado de pedidos inválido.');
  }
  return body;
}

export async function getMyOrderDetail(orderId: string, signal?: AbortSignal): Promise<OrderDetail> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, signal ? { signal } : undefined);
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new OrdersApiError(
      response.status,
      code,
      mapStatusMessage(response.status, code, 'No pudimos cargar el detalle del pedido.'),
    );
  }
  const body: unknown = await response.json();
  if (!isOrderDetail(body)) {
    throw new OrdersApiError(502, 'invalid_response', 'La API devolvió un detalle de pedido inválido.');
  }
  return body;
}

export async function cancelMyOrder(orderId: string, operationId: string): Promise<OrderSummary> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new OrdersApiError(
      response.status,
      code,
      mapStatusMessage(response.status, code, 'No pudimos cancelar el pedido. Inténtalo de nuevo.'),
    );
  }
  const body: unknown = await response.json();
  if (!isOrderSummary(body)) {
    throw new OrdersApiError(502, 'invalid_response', 'La API devolvió una respuesta inválida al cancelar.');
  }
  return body;
}

export async function payMyOrder(orderId: string, operationId: string): Promise<OrderSummary> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new OrdersApiError(
      response.status,
      code,
      mapStatusMessage(response.status, code, 'No pudimos confirmar el pago del pedido. Inténtalo de nuevo.'),
    );
  }
  const body: unknown = await response.json();
  if (!isOrderSummary(body)) {
    throw new OrdersApiError(502, 'invalid_response', 'La API devolvió una respuesta inválida al pagar.');
  }
  return body;
}
