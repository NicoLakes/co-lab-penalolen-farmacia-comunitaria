import type { Database } from '@farmacia/database';
import {
  authUsers,
  inventoryBalances,
  inventoryLocations,
  inventoryLots,
  inventoryMovements,
  inventorySnapshots,
  monthlyProductConsumption,
  orderItems,
  products,
  suppliers,
  therapeuticCategories,
  users,
} from '@farmacia/database/schema';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { authIssuer } from '../auth/auth.js';
import { maxInteger } from '../orders/order-input.js';
import { eligibleInventory, InventoryError, recordInventoryMovement } from './inventory.service.js';

export const saleConditions = [
  'direct_sale',
  'simple_prescription',
  'retained_prescription',
  'retained_prescription_stock_control',
  'prescription_cheque',
  'not_applicable',
] as const;

export type SaleCondition = typeof saleConditions[number];

export class StockManagementError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'not_found'
      | 'duplicate_code'
      | 'product_has_history'
      | 'no_active_location'
      | 'unsupported_tracking'
      | 'insufficient_stock'
      | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'StockManagementError';
  }
}

export interface ManagedStockItem {
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

export interface CreateManagedProductInput {
  code: string;
  name: string;
  description?: string | null | undefined;
  quantityUnit: string;
  activeIngredient?: string | null | undefined;
  dosageForm?: string | null | undefined;
  presentation?: string | null | undefined;
  supplierName?: string | null | undefined;
  therapeuticCategoryName?: string | null | undefined;
  priceClp: number | null;
  saleCondition: SaleCondition | null;
  isPublished: boolean;
  initialStock: number;
  operationId: string;
}

export interface UpdateManagedProductInput {
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

export interface AdjustProductStockInput {
  operationId: string;
  quantityDelta: number;
  reason: string;
  movementType?: 'receipt' | 'adjustment' | undefined;
}

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function cleanRequired(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new StockManagementError('invalid_input', `${label} must be nonblank`);
  }
  return trimmed;
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('\0')) {
    throw new StockManagementError('invalid_input', 'Text fields cannot contain null characters');
  }
  return trimmed;
}

function validatePrice(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0 || value > maxInteger) {
    throw new StockManagementError('invalid_input', 'Price must be a positive CLP integer');
  }
  return value;
}

function validateSaleCondition(value: SaleCondition | null): SaleCondition | null {
  if (value === null) return null;
  if (!saleConditions.some((condition) => condition === value)) {
    throw new StockManagementError('invalid_input', 'Unsupported sale condition');
  }
  return value;
}

function validatePublication(isPublished: boolean, priceClp: number | null, saleCondition: SaleCondition | null) {
  if (isPublished && (priceClp === null || saleCondition === null)) {
    throw new StockManagementError(
      'invalid_input',
      'Published products require both a positive price and a sale condition',
    );
  }
}

async function resolveSupplierId(tx: DbTransaction, rawName: string | null): Promise<string | null> {
  if (!rawName) return null;
  const normalized = rawName.trim();
  const [existing] = await tx.select({ id: suppliers.id }).from(suppliers)
    .where(sql`lower(btrim(${suppliers.name})) = lower(${normalized})`).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(suppliers).values({ name: normalized })
    .onConflictDoNothing().returning({ id: suppliers.id });
  if (created) return created.id;
  const [reread] = await tx.select({ id: suppliers.id }).from(suppliers)
    .where(sql`lower(btrim(${suppliers.name})) = lower(${normalized})`).limit(1);
  if (!reread) throw new Error('Supplier could not be resolved');
  return reread.id;
}

async function resolveCategoryId(tx: DbTransaction, rawName: string | null): Promise<string | null> {
  if (!rawName) return null;
  const normalized = rawName.trim();
  const [existing] = await tx.select({ id: therapeuticCategories.id }).from(therapeuticCategories)
    .where(sql`lower(btrim(${therapeuticCategories.name})) = lower(${normalized})`).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(therapeuticCategories).values({ name: normalized })
    .onConflictDoNothing().returning({ id: therapeuticCategories.id });
  if (created) return created.id;
  const [reread] = await tx.select({ id: therapeuticCategories.id }).from(therapeuticCategories)
    .where(sql`lower(btrim(${therapeuticCategories.name})) = lower(${normalized})`).limit(1);
  if (!reread) throw new Error('Therapeutic category could not be resolved');
  return reread.id;
}

async function resolveTargetLocationId(tx: DbTransaction, preferredLocationIds?: readonly string[]): Promise<string> {
  if (preferredLocationIds && preferredLocationIds.length > 0) {
    const [preferred] = await tx.select({ id: inventoryLocations.id }).from(inventoryLocations)
      .where(and(inArray(inventoryLocations.id, preferredLocationIds), eq(inventoryLocations.isActive, true)))
      .orderBy(asc(inventoryLocations.code))
      .limit(1);
    if (preferred) return preferred.id;
  }
  const [fallback] = await tx.select({ id: inventoryLocations.id }).from(inventoryLocations)
    .where(eq(inventoryLocations.isActive, true))
    .orderBy(asc(inventoryLocations.code))
    .limit(1);
  if (!fallback) {
    throw new StockManagementError('no_active_location', 'No active inventory location is configured');
  }
  return fallback.id;
}

export async function listManagedStock(
  db: Database,
  locationIds?: readonly string[],
  productId?: string,
): Promise<ManagedStockItem[]> {
  const scope = locationIds && locationIds.length > 0
    ? inArray(inventoryLocations.id, locationIds)
    : eq(inventoryLocations.isActive, true);
  const eligible = and(eligibleInventory(), scope);

  const rows = await db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      description: products.description,
      quantityUnit: products.quantityUnit,
      activeIngredient: products.activeIngredient,
      dosageForm: products.dosageForm,
      presentation: products.presentation,
      supplier: suppliers.name,
      therapeuticCategory: therapeuticCategories.name,
      priceClp: products.priceClp,
      saleCondition: products.saleCondition,
      isPublished: products.isPublished,
      inventoryTracking: products.inventoryTracking,
      onHandQuantity: sql<number>`least(coalesce(sum(case when ${scope}
        then ${inventoryBalances.onHandQuantity} else 0 end), 0), ${maxInteger})::int`,
      reservedQuantity: sql<number>`least(coalesce(sum(case when ${scope}
        then ${inventoryBalances.reservedQuantity} else 0 end), 0), ${maxInteger})::int`,
      availableQuantity: sql<number>`least(coalesce(sum(case when ${eligible}
        then ${inventoryBalances.onHandQuantity} - ${inventoryBalances.reservedQuantity} else 0 end), 0), ${maxInteger})::int`,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .leftJoin(therapeuticCategories, eq(therapeuticCategories.id, products.therapeuticCategoryId))
    .leftJoin(inventoryBalances, eq(inventoryBalances.productId, products.id))
    .leftJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(productId ? eq(products.id, productId) : undefined)
    .groupBy(products.id, suppliers.name, therapeuticCategories.name)
    .orderBy(asc(products.name), asc(products.code));

  return rows;
}

export async function createManagedProduct(
  db: Database,
  actorReference: string,
  input: CreateManagedProductInput,
  preferredLocationIds?: readonly string[],
): Promise<ManagedStockItem> {
  const code = cleanRequired(input.code, 'Product code');
  const name = cleanRequired(input.name, 'Product name');
  const quantityUnit = cleanRequired(input.quantityUnit, 'Quantity unit');
  const priceClp = validatePrice(input.priceClp);
  const saleCondition = validateSaleCondition(input.saleCondition);
  validatePublication(input.isPublished, priceClp, saleCondition);

  if (!Number.isInteger(input.initialStock) || input.initialStock < 0 || input.initialStock > maxInteger) {
    throw new StockManagementError('invalid_input', 'Initial stock must be a nonnegative integer');
  }

  const createdId = await db.transaction(async (tx) => {
    const [duplicate] = await tx.select({ id: products.id }).from(products)
      .where(eq(products.code, code)).limit(1);
    if (duplicate) {
      throw new StockManagementError('duplicate_code', 'A product with this code already exists');
    }

    const supplierId = await resolveSupplierId(tx, cleanOptional(input.supplierName));
    const therapeuticCategoryId = await resolveCategoryId(tx, cleanOptional(input.therapeuticCategoryName));
    const locationId = await resolveTargetLocationId(tx, preferredLocationIds);

    const [created] = await tx.insert(products).values({
      code,
      name,
      description: cleanOptional(input.description),
      quantityUnit,
      activeIngredient: cleanOptional(input.activeIngredient),
      dosageForm: cleanOptional(input.dosageForm),
      presentation: cleanOptional(input.presentation),
      supplierId,
      therapeuticCategoryId,
      priceClp,
      saleCondition,
      isPublished: input.isPublished,
      inventoryTracking: 'quantity_only',
    }).returning({ id: products.id });
    if (!created) throw new Error('Product insert did not return a row');

    const [balance] = await tx.insert(inventoryBalances).values({
      productId: created.id,
      locationId,
      lotId: null,
      onHandQuantity: input.initialStock,
    }).returning({ id: inventoryBalances.id });
    if (!balance) throw new Error('Inventory balance insert did not return a row');

    if (input.initialStock > 0) {
      await tx.insert(inventoryMovements).values({
        balanceId: balance.id,
        movementType: 'opening',
        quantityDelta: input.initialStock,
        reason: 'Stock inicial al crear producto',
        operationId: input.operationId.toLowerCase(),
        actorReference,
      });
    }

    return created.id;
  });

  const [item] = await listManagedStock(db, preferredLocationIds, createdId);
  if (!item) throw new Error('Created product could not be read back');
  return item;
}

export async function updateManagedProduct(
  db: Database,
  productId: string,
  input: UpdateManagedProductInput,
  preferredLocationIds?: readonly string[],
): Promise<ManagedStockItem> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
    if (!existing) {
      throw new StockManagementError('not_found', 'Product not found');
    }

    const nextName = input.name !== undefined ? cleanRequired(input.name, 'Product name') : existing.name;
    const nextDescription = input.description !== undefined ? cleanOptional(input.description) : existing.description;
    const nextActiveIngredient = input.activeIngredient !== undefined
      ? cleanOptional(input.activeIngredient) : existing.activeIngredient;
    const nextDosageForm = input.dosageForm !== undefined ? cleanOptional(input.dosageForm) : existing.dosageForm;
    const nextPresentation = input.presentation !== undefined ? cleanOptional(input.presentation) : existing.presentation;
    const nextPriceClp = input.priceClp !== undefined ? validatePrice(input.priceClp) : existing.priceClp;
    const nextSaleCondition = input.saleCondition !== undefined
      ? validateSaleCondition(input.saleCondition) : existing.saleCondition;
    const nextIsPublished = input.isPublished !== undefined ? input.isPublished : existing.isPublished;

    validatePublication(nextIsPublished, nextPriceClp, nextSaleCondition);

    const nextSupplierId = input.supplierName !== undefined
      ? await resolveSupplierId(tx, cleanOptional(input.supplierName)) : existing.supplierId;
    const nextCategoryId = input.therapeuticCategoryName !== undefined
      ? await resolveCategoryId(tx, cleanOptional(input.therapeuticCategoryName)) : existing.therapeuticCategoryId;

    await tx.update(products).set({
      name: nextName,
      description: nextDescription,
      activeIngredient: nextActiveIngredient,
      dosageForm: nextDosageForm,
      presentation: nextPresentation,
      supplierId: nextSupplierId,
      therapeuticCategoryId: nextCategoryId,
      priceClp: nextPriceClp,
      saleCondition: nextSaleCondition,
      isPublished: nextIsPublished,
    }).where(eq(products.id, productId));
  });

  const [item] = await listManagedStock(db, preferredLocationIds, productId);
  if (!item) throw new Error('Updated product could not be read back');
  return item;
}

export async function adjustProductStock(
  db: Database,
  actorReference: string,
  productId: string,
  input: AdjustProductStockInput,
  preferredLocationIds?: readonly string[],
): Promise<ManagedStockItem> {
  const balanceId = await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
    if (!product) {
      throw new StockManagementError('not_found', 'Product not found');
    }
    if (product.inventoryTracking === 'lot_and_expiration') {
      throw new StockManagementError(
        'unsupported_tracking',
        'Lot-tracked products require a lot-specific movement workflow',
      );
    }
    if (product.inventoryTracking === null) {
      await tx.update(products).set({ inventoryTracking: 'quantity_only' }).where(eq(products.id, productId));
    }

    const locationId = await resolveTargetLocationId(tx, preferredLocationIds);
    const [existingBalance] = await tx.select({ id: inventoryBalances.id }).from(inventoryBalances)
      .where(and(
        eq(inventoryBalances.productId, productId),
        eq(inventoryBalances.locationId, locationId),
        isNull(inventoryBalances.lotId),
      )).limit(1);
    if (existingBalance) return existingBalance.id;

    const [createdBalance] = await tx.insert(inventoryBalances).values({
      productId,
      locationId,
      lotId: null,
      onHandQuantity: 0,
    }).returning({ id: inventoryBalances.id });
    if (!createdBalance) throw new Error('Inventory balance could not be created');
    return createdBalance.id;
  });

  const movementType = input.movementType ?? (input.quantityDelta > 0 ? 'receipt' : 'adjustment');
  try {
    await recordInventoryMovement(db, actorReference, {
      operationId: input.operationId,
      balanceId,
      movementType,
      quantityDelta: input.quantityDelta,
      reason: input.reason,
    });
  } catch (error) {
    if (error instanceof InventoryError) {
      throw new StockManagementError(error.code, error.message);
    }
    throw error;
  }

  const [item] = await listManagedStock(db, preferredLocationIds, productId);
  if (!item) throw new Error('Adjusted product could not be read back');
  return item;
}

export async function deleteManagedProduct(db: Database, productId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products)
      .where(eq(products.id, productId)).for('update');
    if (!product) {
      throw new StockManagementError('not_found', 'Product not found');
    }

    const [hasOrder] = await tx.select({ id: orderItems.id }).from(orderItems)
      .where(eq(orderItems.productId, productId)).limit(1);
    const [hasSnapshot] = await tx.select({ id: inventorySnapshots.id }).from(inventorySnapshots)
      .where(eq(inventorySnapshots.productId, productId)).limit(1);
    const [hasConsumption] = await tx.select({ id: monthlyProductConsumption.id }).from(monthlyProductConsumption)
      .where(eq(monthlyProductConsumption.productId, productId)).limit(1);
    const [hasLot] = await tx.select({ id: inventoryLots.id }).from(inventoryLots)
      .where(eq(inventoryLots.productId, productId)).limit(1);

    const balances = await tx.select({ id: inventoryBalances.id, onHand: inventoryBalances.onHandQuantity })
      .from(inventoryBalances).where(eq(inventoryBalances.productId, productId)).for('update');
    const balanceIds = balances.map((row) => row.id);
    const [hasMovement] = balanceIds.length > 0
      ? await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)
          .where(inArray(inventoryMovements.balanceId, balanceIds)).limit(1)
      : [];

    if (hasOrder || hasSnapshot || hasConsumption || hasLot || hasMovement
      || balances.some((row) => row.onHand > 0)) {
      throw new StockManagementError(
        'product_has_history',
        'Product has recorded stock movements or orders and cannot be deleted',
      );
    }

    if (balanceIds.length > 0) {
      await tx.delete(inventoryBalances).where(inArray(inventoryBalances.id, balanceIds));
    }
    await tx.delete(products).where(eq(products.id, productId));
  });
}

export const movementTypes = [
  'opening',
  'receipt',
  'sale',
  'adjustment',
  'transfer_out',
  'transfer_in',
] as const;

export type InventoryMovementType = typeof movementTypes[number];

export interface InventoryMovementAuditItem {
  id: string;
  createdAt: Date;
  movementType: InventoryMovementType;
  quantityDelta: number;
  reason: string;
  actorReference: string;
  actorEmail: string | null;
  productCode: string;
  productName: string;
  locationName: string;
  lotNumber: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function extractActorUserId(actorReference: string): string | null {
  const match = /^(?:user|buyer):(.+)$/.exec(actorReference);
  const candidate = match?.[1];
  return candidate && UUID_REGEX.test(candidate) ? candidate.toLowerCase() : null;
}

export async function listInventoryMovements(
  db: Database,
  options: { query?: string | undefined; movementType?: InventoryMovementType | undefined; limit?: number | undefined } = {},
): Promise<InventoryMovementAuditItem[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 200);
  const trimmed = options.query?.trim().toLowerCase() ?? '';
  const escaped = trimmed.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const pattern = `%${escaped}%`;

  const conditions = [];
  if (options.movementType) {
    conditions.push(eq(inventoryMovements.movementType, options.movementType));
  }
  if (trimmed) {
    conditions.push(or(
      sql`lower(${products.code}) LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(${products.name}) LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(${inventoryMovements.reason}) LIKE ${pattern} ESCAPE '\\'`,
    ));
  }

  const rows = await db.select({
    id: inventoryMovements.id,
    createdAt: inventoryMovements.createdAt,
    movementType: inventoryMovements.movementType,
    quantityDelta: inventoryMovements.quantityDelta,
    reason: inventoryMovements.reason,
    actorReference: inventoryMovements.actorReference,
    productCode: products.code,
    productName: products.name,
    locationName: inventoryLocations.name,
    lotNumber: inventoryLots.lotNumber,
  }).from(inventoryMovements)
    .innerJoin(inventoryBalances, eq(inventoryBalances.id, inventoryMovements.balanceId))
    .innerJoin(products, eq(products.id, inventoryBalances.productId))
    .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(safeLimit);

  const actorUserIds = [...new Set(
    rows.map((row) => extractActorUserId(row.actorReference)).filter((id): id is string => id !== null),
  )];
  const emailByUserId = new Map<string, string>();
  if (actorUserIds.length > 0) {
    const actorRows = await db.select({ id: users.id, email: authUsers.email }).from(users)
      .innerJoin(authUsers, and(eq(users.identityIssuer, authIssuer), eq(authUsers.id, users.identitySubject)))
      .where(inArray(users.id, actorUserIds));
    for (const actor of actorRows) {
      emailByUserId.set(actor.id, actor.email);
    }
  }

  return rows.map((row) => {
    const actorId = extractActorUserId(row.actorReference);
    return {
      ...row,
      actorEmail: actorId ? (emailByUserId.get(actorId) ?? null) : null,
    };
  });
}
