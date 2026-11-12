import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, pgEnum, pgSequence, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { inventoryBalances, inventoryMovements } from './operational-inventory.js';
import { productSaleCondition, products } from './products.js';
import { users } from './users.js';

export const orderStatus = pgEnum('order_status', ['pending_payment', 'confirmed', 'fulfilled', 'cancelled', 'expired']);
export const fulfillmentMethod = pgEnum('fulfillment_method', ['pickup', 'delivery']);
export const stockReservationStatus = pgEnum('stock_reservation_status', ['active', 'released', 'consumed']);
export const orderNumberSequence = pgSequence('order_number_seq');

export interface DeliveryDetails {
  recipientName: string;
  phone: string;
  address: string;
  commune: string;
}

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: text('order_number').notNull().unique().default(sql`'FC-' || nextval('order_number_seq')`),
  buyerId: uuid('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: orderStatus('status').notNull().default('pending_payment'),
  fulfillmentMethod: fulfillmentMethod('fulfillment_method').notNull(),
  deliveryDetailsSnapshot: jsonb('delivery_details_snapshot').$type<DeliveryDetails>(),
  subtotalClp: bigint('subtotal_clp', { mode: 'bigint' }).notNull(),
  deliveryFeeClp: integer('delivery_fee_clp').notNull().default(0),
  totalClp: bigint('total_clp', { mode: 'bigint' }).notNull().generatedAlwaysAs(sql`subtotal_clp + delivery_fee_clp`),
  reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }).notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('orders_buyer_idempotency_unique').on(table.buyerId, table.idempotencyKey),
  check('orders_amounts_valid', sql`${table.subtotalClp} > 0 AND ${table.deliveryFeeClp} >= 0`),
  check('orders_deadline_valid', sql`isfinite(${table.reservationExpiresAt}) AND ${table.reservationExpiresAt} > ${table.createdAt}`),
  check('orders_fulfillment_details_valid', sql`(
    ${table.fulfillmentMethod} = 'pickup' AND ${table.deliveryDetailsSnapshot} IS NULL AND ${table.deliveryFeeClp} = 0
  ) OR (
    ${table.fulfillmentMethod} = 'delivery' AND ${table.deliveryDetailsSnapshot} IS NOT NULL
    AND jsonb_typeof(${table.deliveryDetailsSnapshot}) = 'object'
  )`),
  index('orders_pending_deadline_idx').on(table.reservationExpiresAt, table.id).where(sql`${table.status} = 'pending_payment'`),
]);

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productCodeSnapshot: text('product_code_snapshot').notNull(),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  quantityUnitSnapshot: text('quantity_unit_snapshot').notNull(),
  saleConditionSnapshot: productSaleCondition('sale_condition_snapshot').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceClp: integer('unit_price_clp').notNull(),
  lineTotalClp: bigint('line_total_clp', { mode: 'bigint' }).notNull().generatedAlwaysAs(sql`unit_price_clp::bigint * quantity`),
}, (table) => [
  unique('order_items_order_product_unique').on(table.orderId, table.productId),
  unique('order_items_id_product_unique').on(table.id, table.productId),
  check('order_items_amounts_valid', sql`${table.quantity} > 0 AND ${table.unitPriceClp} > 0`),
  index('order_items_product_idx').on(table.productId),
]);

export const stockReservations = pgTable('stock_reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderItemId: uuid('order_item_id').notNull(),
  productId: uuid('product_id').notNull(),
  balanceId: uuid('balance_id').notNull(),
  quantity: integer('quantity').notNull(),
  status: stockReservationStatus('status').notNull().default('active'),
  consumedMovementId: uuid('consumed_movement_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [
  unique('stock_reservations_item_balance_unique').on(table.orderItemId, table.balanceId),
  foreignKey({
    name: 'stock_reservations_item_product_fk',
    columns: [table.orderItemId, table.productId],
    foreignColumns: [orderItems.id, orderItems.productId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'stock_reservations_balance_product_fk',
    columns: [table.balanceId, table.productId],
    foreignColumns: [inventoryBalances.id, inventoryBalances.productId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'stock_reservations_movement_balance_fk',
    columns: [table.consumedMovementId, table.balanceId],
    foreignColumns: [inventoryMovements.id, inventoryMovements.balanceId],
  }).onDelete('restrict'),
  check('stock_reservations_quantity_positive', sql`${table.quantity} > 0`),
  check('stock_reservations_closure_valid', sql`
    (${table.status} = 'active') = (${table.closedAt} IS NULL)
    AND (${table.status} = 'consumed') = (${table.consumedMovementId} IS NOT NULL)
    AND (${table.closedAt} IS NULL OR ${table.closedAt} >= ${table.createdAt})
  `),
  index('stock_reservations_balance_status_idx').on(table.balanceId, table.status),
]);

export const orderStatusEvents = pgTable('order_status_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
  fromStatus: orderStatus('from_status'),
  toStatus: orderStatus('to_status').notNull(),
  reason: text('reason').notNull(),
  actorReference: text('actor_reference').notNull(),
  operationId: uuid('operation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('order_status_events_operation_unique').on(table.orderId, table.operationId),
  check('order_status_events_actor_reason_valid', sql`${table.actorReference} ~ '[^[:space:]]' AND ${table.reason} ~ '[^[:space:]]'`),
  check('order_status_events_transition_valid', sql`CASE
    WHEN ${table.fromStatus} IS NULL THEN ${table.toStatus} = 'pending_payment'
    WHEN ${table.fromStatus} = 'pending_payment' THEN ${table.toStatus} IN ('confirmed', 'cancelled', 'expired')
    WHEN ${table.fromStatus} = 'confirmed' THEN ${table.toStatus} = 'fulfilled'
    ELSE false END`),
]);
