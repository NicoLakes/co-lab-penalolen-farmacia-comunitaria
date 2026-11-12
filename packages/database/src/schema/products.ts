import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const productSaleCondition = pgEnum('product_sale_condition', [
  'direct_sale',
  'simple_prescription',
  'retained_prescription',
  'retained_prescription_stock_control',
  'prescription_cheque',
  'not_applicable',
]);

export const inventoryTracking = pgEnum('inventory_tracking', [
  'quantity_only',
  'lot_and_expiration',
]);

export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
}, (table) => [
  check('suppliers_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  uniqueIndex('suppliers_name_unique').on(sql`lower(btrim(${table.name}))`),
]);

export const therapeuticCategories = pgTable('therapeutic_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
}, (table) => [
  check('therapeutic_categories_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  uniqueIndex('therapeutic_categories_name_unique').on(sql`lower(btrim(${table.name}))`),
]);

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  quantityUnit: text('quantity_unit').notNull(),
  activeIngredient: text('active_ingredient'),
  dosageForm: text('dosage_form'),
  presentation: text('presentation'),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  therapeuticCategoryId: uuid('therapeutic_category_id')
    .references(() => therapeuticCategories.id, { onDelete: 'restrict' }),
  saleCondition: productSaleCondition('sale_condition'),
  priceClp: integer('price_clp'),
  isPublished: boolean('is_published').notNull().default(false),
  inventoryTracking: inventoryTracking('inventory_tracking'),
}, (table) => [
  check('products_code_not_blank', sql`length(${table.code}) > 0 AND ${table.code} = btrim(${table.code})`),
  check('products_name_not_blank', sql`${table.name} ~ '[^[:space:]]'`),
  check('products_description_not_blank', sql`${table.description} IS NULL OR ${table.description} ~ '[^[:space:]]'`),
  check('products_price_clp_positive', sql`${table.priceClp} IS NULL OR ${table.priceClp} > 0`),
  check('products_publication_requires_commercial_data', sql`NOT ${table.isPublished} OR (${table.priceClp} IS NOT NULL AND ${table.saleCondition} IS NOT NULL)`),
  check('products_quantity_unit_not_blank', sql`length(btrim(${table.quantityUnit})) > 0`),
  check('products_active_ingredient_not_blank', sql`${table.activeIngredient} IS NULL OR length(btrim(${table.activeIngredient})) > 0`),
  check('products_dosage_form_not_blank', sql`${table.dosageForm} IS NULL OR length(btrim(${table.dosageForm})) > 0`),
  check('products_presentation_not_blank', sql`${table.presentation} IS NULL OR length(btrim(${table.presentation})) > 0`),
  index('products_supplier_idx').on(table.supplierId),
  index('products_therapeutic_category_idx').on(table.therapeuticCategoryId),
]);
