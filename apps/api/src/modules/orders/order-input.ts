import type { DeliveryDetails } from '@farmacia/database/schema';

export class OrderError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'not_found' | 'conflict' | 'insufficient_stock' | 'unavailable_product' | 'expired',
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export const maxInteger = 2_147_483_647;
export const maxClp = 9_223_372_036_854_775_807n;

export function orderUuid(value: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new OrderError('invalid_input', 'A valid UUID is required');
  }
  return value.toLowerCase();
}

export function requiredText(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new OrderError('invalid_input', 'A nonblank text value is required');
  }
  return value.trim();
}

export interface CreateOrderInput {
  idempotencyKey: string;
  items: readonly { productId: string; quantity: number }[];
  fulfillment: { method: 'pickup' } | { method: 'delivery'; details: DeliveryDetails };
}

// The backend supplies fulfillment locations, delivery pricing and the reservation window.
export interface OrderPolicy {
  locationIds: readonly string[];
  reservationSeconds: number;
  deliveryFeeClp: number;
}

export function normalizeOrderInput(input: CreateOrderInput, policy: OrderPolicy) {
  const requestedItems = input.items;
  if (!Array.isArray(input.items) || input.items.length === 0 || !policy.locationIds.length
    || !Number.isInteger(policy.reservationSeconds) || policy.reservationSeconds <= 0 || policy.reservationSeconds > maxInteger
    || !Number.isInteger(policy.deliveryFeeClp) || policy.deliveryFeeClp < 0 || policy.deliveryFeeClp > maxInteger) {
    throw new OrderError('invalid_input', 'Order items and fulfillment policy must be valid');
  }
  const items = requestedItems.map((item) => {
    if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > maxInteger) {
      throw new OrderError('invalid_input', 'Item quantity must be a positive integer');
    }
    return { productId: orderUuid(item.productId), quantity: item.quantity };
  }).sort((first, second) => first.productId.localeCompare(second.productId));
  if (new Set(items.map((item) => item.productId)).size !== items.length) {
    throw new OrderError('invalid_input', 'Include each product only once');
  }
  const method = input.fulfillment?.method;
  if (method !== 'pickup' && method !== 'delivery') {
    throw new OrderError('invalid_input', 'Invalid fulfillment method');
  }
  let deliveryDetails: DeliveryDetails | null = null;
  if (input.fulfillment.method === 'delivery') {
    const details = input.fulfillment.details;
    if (!details || typeof details !== 'object') throw new OrderError('invalid_input', 'Delivery details are required');
    deliveryDetails = {
      recipientName: requiredText(details.recipientName),
      phone: requiredText(details.phone),
      address: requiredText(details.address),
      commune: requiredText(details.commune),
    };
  }
  return {
    items, method, deliveryDetails,
    idempotencyKey: orderUuid(input.idempotencyKey),
    locationIds: [...new Set(policy.locationIds.map(orderUuid))],
    reservationSeconds: policy.reservationSeconds,
    deliveryFeeClp: method === 'delivery' ? policy.deliveryFeeClp : 0,
  };
}
