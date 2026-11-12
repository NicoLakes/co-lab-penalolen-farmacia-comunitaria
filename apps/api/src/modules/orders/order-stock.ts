import type { Database } from '@farmacia/database';
import { inventoryBalances, inventoryLocations, inventoryLots, products } from '@farmacia/database/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { eligibleInventory } from '../inventory/inventory.service.js';

export type OrderTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export const supportedSaleConditions = ['direct_sale', 'not_applicable'] as const;

export function lockBalances(tx: OrderTransaction, condition: SQL | undefined) {
  return tx.select().from(inventoryBalances).where(condition)
    .orderBy(inventoryBalances.id).for('update');
}

export async function findEligibleBalances(tx: OrderTransaction, balanceIds: string[]) {
  if (balanceIds.length === 0) return [];
  return tx.select({
    id: inventoryBalances.id,
    expiresOn: inventoryLots.expiresOn,
  }).from(inventoryBalances)
    .innerJoin(products, eq(products.id, inventoryBalances.productId))
    .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(and(inArray(inventoryBalances.id, balanceIds), eligibleInventory(),
      inArray(products.saleCondition, supportedSaleConditions)))
    .orderBy(sql`${inventoryLots.expiresOn} ASC NULLS LAST`, inventoryBalances.id)
    .for('share', { of: [products, inventoryLocations] });
}
