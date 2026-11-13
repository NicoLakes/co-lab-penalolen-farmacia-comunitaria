import { randomUUID } from 'node:crypto';
import type { Database } from '@farmacia/database';
import {
  inventoryBalances,
  inventoryLocations,
  inventoryLots,
  products,
  suppliers,
  therapeuticCategories,
} from '@farmacia/database/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { eligibleInventory, recordInventoryMovement } from '../inventory/inventory.service.js';

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  description: string;
  activeIngredient: string;
  dosageForm: string;
  presentation: string;
  supplier: string;
  therapeuticCategory: string;
  priceClp: number;
  stock: number;
  saleCondition: string;
  requiresPrescription: boolean;
}

const DEFAULT_LOCATION = {
  code: 'PENALOLEN-CENTRAL',
  name: 'Farmacia Comunitaria Peñalolén',
} as const;

const INITIAL_CATALOG_SEED = [
  {
    code: '11313',
    activeIngredient: 'AC. ACETIL SALICILICO 100 MG',
    description: 'ACIDO ACETILSALICILICO 100 MG X 100 COMP',
    dosageForm: 'COMPRIMIDO',
    presentation: '100 comprimidos',
    supplier: 'MINTLAB',
    therapeuticCategory: 'CARDIOVASCULAR',
    priceClp: 1490,
    stock: 45,
    saleCondition: 'direct_sale' as const,
  },
  {
    code: '9231',
    activeIngredient: 'ACENOCUMAROL 4 MG',
    description: 'ACENOCUMAROL 4mg X 20 COMP',
    dosageForm: 'COMPRIMIDO',
    presentation: '20 comprimidos',
    supplier: 'ABBOTT',
    therapeuticCategory: 'CARDIOVASCULAR',
    priceClp: 2850,
    stock: 18,
    saleCondition: 'simple_prescription' as const,
  },
  {
    code: '1991',
    activeIngredient: 'ACIDO VALPROICO 375 MG/ML',
    description: 'ATEMPERATOR 375MG/ML GOTAS ORALES',
    dosageForm: 'SOLUCION GOTAS ORALES',
    presentation: 'Frasco Gotario 15 ml',
    supplier: 'FERRER',
    therapeuticCategory: 'SALUD MENTAL',
    priceClp: 6400,
    stock: 12,
    saleCondition: 'simple_prescription' as const,
  },
  {
    code: '10464',
    activeIngredient: 'ACIDO MEFENAMICO 500 MG',
    description: 'ACIDO MEFENAMICO 500 MG X 10 COMP',
    dosageForm: 'COMPRIMIDO',
    presentation: '10 comprimidos',
    supplier: 'CARIBEAN',
    therapeuticCategory: 'ANALGESICO',
    priceClp: 990,
    stock: 30,
    saleCondition: 'direct_sale' as const,
  },
  {
    code: '14979',
    activeIngredient: 'ACIDO ALENDRONICO 70 MG',
    description: 'ALDROX 70 MG X 10 COMPRIMIDOS',
    dosageForm: 'COMPRIMIDO RECUBIERTO',
    presentation: '10 comprimidos recubiertos',
    supplier: 'SAVAL',
    therapeuticCategory: 'ARTRITIS, ARTROSIS',
    priceClp: 3900,
    stock: 8,
    saleCondition: 'simple_prescription' as const,
  },
  {
    code: '15600',
    activeIngredient: 'ALCOHOL 70°',
    description: 'ALCOHOL 70° LITRO (F)',
    dosageForm: 'DISPOSITIVO MEDICO',
    presentation: 'Frasco 1 litro',
    supplier: 'CARIBEAN',
    therapeuticCategory: 'INSUMO MEDICO',
    priceClp: 1800,
    stock: 60,
    saleCondition: 'direct_sale' as const,
  },
] as const;

export async function ensureInitialCatalog(db: Database): Promise<{ locationId: string }> {
  await db
    .insert(inventoryLocations)
    .values({ code: DEFAULT_LOCATION.code, name: DEFAULT_LOCATION.name, isActive: true })
    .onConflictDoNothing({ target: inventoryLocations.code });

  const [location] = await db
    .select()
    .from(inventoryLocations)
    .where(eq(inventoryLocations.code, DEFAULT_LOCATION.code));

  if (!location) {
    throw new Error('Default pharmacy location could not be initialized');
  }

  for (const item of INITIAL_CATALOG_SEED) {
    const [existingProduct] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.code, item.code));

    if (existingProduct) continue;

    await db
      .insert(suppliers)
      .values({ name: item.supplier })
      .onConflictDoNothing();
    const [supplierRow] = await db
      .select()
      .from(suppliers)
      .where(sql`lower(btrim(${suppliers.name})) = lower(btrim(${item.supplier}))`);

    await db
      .insert(therapeuticCategories)
      .values({ name: item.therapeuticCategory })
      .onConflictDoNothing();
    const [categoryRow] = await db
      .select()
      .from(therapeuticCategories)
      .where(sql`lower(btrim(${therapeuticCategories.name})) = lower(btrim(${item.therapeuticCategory}))`);

    const [createdProduct] = await db
      .insert(products)
      .values({
        code: item.code,
        name: item.activeIngredient,
        description: item.description,
        quantityUnit: 'envase',
        activeIngredient: item.activeIngredient,
        dosageForm: item.dosageForm,
        presentation: item.presentation,
        supplierId: supplierRow?.id ?? null,
        therapeuticCategoryId: categoryRow?.id ?? null,
        saleCondition: item.saleCondition,
        priceClp: item.priceClp,
        isPublished: true,
        inventoryTracking: 'quantity_only',
      })
      .onConflictDoNothing({ target: products.code })
      .returning();

    if (!createdProduct) continue;

    const [balance] = await db
      .insert(inventoryBalances)
      .values({
        productId: createdProduct.id,
        locationId: location.id,
      })
      .returning();

    if (balance && item.stock > 0) {
      await recordInventoryMovement(db, 'system:initial-seed', {
        operationId: randomUUID(),
        balanceId: balance.id,
        movementType: 'opening',
        quantityDelta: item.stock,
        reason: 'Initial community pharmacy catalog stock',
      });
    }
  }

  return { locationId: location.id };
}

export async function listPublishedCatalog(db: Database): Promise<CatalogItem[]> {
  const rows = await db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      description: products.description,
      activeIngredient: products.activeIngredient,
      dosageForm: products.dosageForm,
      presentation: products.presentation,
      supplier: suppliers.name,
      therapeuticCategory: therapeuticCategories.name,
      priceClp: products.priceClp,
      saleCondition: products.saleCondition,
      availableStock: sql<number>`coalesce(sum(case when ${eligibleInventory()} then ${inventoryBalances.onHandQuantity} - ${inventoryBalances.reservedQuantity} else 0 end), 0)::int`,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .leftJoin(therapeuticCategories, eq(therapeuticCategories.id, products.therapeuticCategoryId))
    .leftJoin(inventoryBalances, eq(inventoryBalances.productId, products.id))
    .leftJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(and(eq(products.isPublished, true), sql`${products.priceClp} IS NOT NULL`))
    .groupBy(
      products.id,
      suppliers.name,
      therapeuticCategories.name,
    )
    .orderBy(asc(products.name), asc(products.code));

  return rows.map((row) => {
    const saleCondition = row.saleCondition ?? 'direct_sale';
    const requiresPrescription = saleCondition !== 'direct_sale' && saleCondition !== 'not_applicable';
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? row.name,
      activeIngredient: row.activeIngredient ?? row.name,
      dosageForm: row.dosageForm ?? 'UNIDAD',
      presentation: row.presentation ?? '1 unidad',
      supplier: row.supplier ?? 'SIN ESPECIFICAR',
      therapeuticCategory: row.therapeuticCategory ?? 'GENERAL',
      priceClp: row.priceClp ?? 0,
      stock: Math.max(0, Number(row.availableStock)),
      saleCondition,
      requiresPrescription,
    };
  });
}
