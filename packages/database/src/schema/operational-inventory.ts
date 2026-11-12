import { sql } from 'drizzle-orm';
import {
  boolean, check, date, foreignKey, index, integer, pgEnum, pgTable,
  text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { inventoryLocations } from './inventory.js';
import { products } from './products.js';

export const inventoryMovementType = pgEnum('inventory_movement_type', [
  'opening', 'receipt', 'sale', 'adjustment', 'transfer_out', 'transfer_in',
]);

export const inventoryLots = pgTable('inventory_lots', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  lotNumber: text('lot_number').notNull(),
  expiresOn: date('expires_on').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('inventory_lots_product_number_unique').on(table.productId, table.lotNumber),
  unique('inventory_lots_id_product_unique').on(table.id, table.productId),
  check('inventory_lots_number_valid', sql`${table.lotNumber} ~ '[^[:space:]]' AND ${table.lotNumber} = btrim(${table.lotNumber})`),
  check('inventory_lots_expiration_finite', sql`isfinite(${table.expiresOn})`),
]);

export const inventoryBalances = pgTable('inventory_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => inventoryLocations.id, { onDelete: 'restrict' }),
  lotId: uuid('lot_id'),
  onHandQuantity: integer('on_hand_quantity').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  isBlocked: boolean('is_blocked').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('inventory_balances_product_location_lot_unique')
    .on(table.productId, table.locationId, table.lotId).nullsNotDistinct(),
  unique('inventory_balances_id_product_unique').on(table.id, table.productId),
  foreignKey({
    name: 'inventory_balances_lot_product_fk',
    columns: [table.lotId, table.productId],
    foreignColumns: [inventoryLots.id, inventoryLots.productId],
  }).onDelete('restrict'),
  check('inventory_balances_on_hand_nonnegative', sql`${table.onHandQuantity} >= 0`),
  check('inventory_balances_reserved_valid', sql`${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.onHandQuantity}`),
  index('inventory_balances_location_idx').on(table.locationId),
  index('inventory_balances_lot_product_idx').on(table.lotId, table.productId),
]);

export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  balanceId: uuid('balance_id').notNull().references(() => inventoryBalances.id, { onDelete: 'restrict' }),
  movementType: inventoryMovementType('movement_type').notNull(),
  quantityDelta: integer('quantity_delta').notNull(),
  reason: text('reason').notNull(),
  operationId: uuid('operation_id').notNull(),
  actorReference: text('actor_reference').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('inventory_movements_operation_balance_unique').on(table.operationId, table.balanceId),
  unique('inventory_movements_id_balance_unique').on(table.id, table.balanceId),
  check('inventory_movements_delta_nonzero', sql`${table.quantityDelta} <> 0`),
  check('inventory_movements_delta_sign', sql`(
    ${table.movementType} IN ('opening', 'receipt', 'transfer_in') AND ${table.quantityDelta} > 0
  ) OR (
    ${table.movementType} IN ('sale', 'transfer_out') AND ${table.quantityDelta} < 0
  ) OR ${table.movementType} = 'adjustment'`),
  check('inventory_movements_reason_not_blank', sql`${table.reason} ~ '[^[:space:]]'`),
  check('inventory_movements_actor_not_blank', sql`${table.actorReference} ~ '[^[:space:]]'`),
  index('inventory_movements_balance_created_idx').on(table.balanceId, table.createdAt),
  uniqueIndex('inventory_movements_opening_unique').on(table.balanceId)
    .where(sql`${table.movementType} = 'opening'`),
]);
