import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from './products.js';

export const inventoryLocations = pgTable('inventory_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
}, (table) => [
  check('inventory_locations_code_not_blank', sql`length(${table.code}) > 0 AND ${table.code} = btrim(${table.code})`),
  check('inventory_locations_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  uniqueIndex('inventory_locations_name_unique').on(sql`lower(btrim(${table.name}))`),
]);

export const inventorySnapshots = pgTable('inventory_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => inventoryLocations.id, { onDelete: 'restrict' }),
  observedOn: date('observed_on').notNull(),
  quantity: integer('quantity').notNull(),
  sourceSha256: text('source_sha256').notNull(),
  sourceSheet: text('source_sheet').notNull(),
  sourceRow: integer('source_row').notNull(),
}, (table) => [
  unique('inventory_snapshots_product_location_date_unique').on(table.productId, table.locationId, table.observedOn),
  check('inventory_snapshots_quantity_nonnegative', sql`${table.quantity} >= 0`),
  check('inventory_snapshots_source_sha256_valid', sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  check('inventory_snapshots_source_sheet_not_blank', sql`length(btrim(${table.sourceSheet})) > 0`),
  check('inventory_snapshots_source_row_positive', sql`${table.sourceRow} > 0`),
  index('inventory_snapshots_location_date_idx').on(table.locationId, table.observedOn),
]);

export const monthlyProductConsumption = pgTable('monthly_product_consumption', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  period: date('period').notNull(),
  // Preserve the source sign until dispensing and adjustment semantics are confirmed.
  sourceQuantity: integer('source_quantity').notNull(),
  sourceSha256: text('source_sha256').notNull(),
  sourceSheet: text('source_sheet').notNull(),
  sourceRow: integer('source_row').notNull(),
}, (table) => [
  unique('monthly_product_consumption_product_period_unique').on(table.productId, table.period),
  check('monthly_product_consumption_period_first_day', sql`extract(day from ${table.period}) = 1`),
  check('monthly_product_consumption_source_sha256_valid', sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  check('monthly_product_consumption_source_sheet_not_blank', sql`length(btrim(${table.sourceSheet})) > 0`),
  check('monthly_product_consumption_source_row_positive', sql`${table.sourceRow} > 0`),
  index('monthly_product_consumption_period_idx').on(table.period),
]);
