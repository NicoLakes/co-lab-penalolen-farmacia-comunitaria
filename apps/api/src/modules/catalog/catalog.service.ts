import type { Database } from '@farmacia/database';
import {
  inventoryBalances,
  inventoryLocations,
  inventoryLots,
  products,
  suppliers,
  therapeuticCategories,
} from '@farmacia/database/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { eligibleInventory } from '../inventory/inventory.service.js';
import { maxInteger } from '../orders/order-input.js';
import { supportedSaleConditions } from '../orders/order-stock.js';

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

export async function listPublishedCatalog(db: Database, locationIds?: readonly string[]): Promise<CatalogItem[]> {
  const available = and(eligibleInventory(), locationIds && inArray(inventoryLocations.id, locationIds));
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
      availableStock: sql<number>`least(coalesce(sum(case when ${available}
        then ${inventoryBalances.onHandQuantity} - ${inventoryBalances.reservedQuantity}
        else 0 end), 0), ${maxInteger})::int`,
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
    const saleCondition = row.saleCondition;
    if (saleCondition === null || row.priceClp === null) {
      throw new Error('Published catalog item is missing its sale condition or price');
    }
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description ?? row.name,
      activeIngredient: row.activeIngredient ?? row.name,
      dosageForm: row.dosageForm ?? 'SIN ESPECIFICAR',
      presentation: row.presentation ?? 'SIN ESPECIFICAR',
      supplier: row.supplier ?? 'SIN ESPECIFICAR',
      therapeuticCategory: row.therapeuticCategory ?? 'GENERAL',
      priceClp: row.priceClp,
      stock: row.availableStock,
      saleCondition,
      requiresPrescription: !supportedSaleConditions.some((condition) => condition === saleCondition),
    };
  });
}
