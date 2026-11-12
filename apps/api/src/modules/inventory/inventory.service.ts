import type { Database } from '@farmacia/database';
import { inventoryBalances, inventoryLocations, inventoryLots, inventoryMovements, products } from '@farmacia/database/schema';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

export class InventoryError extends Error {
  constructor(readonly code: 'invalid_input' | 'not_found' | 'conflict' | 'insufficient_stock', message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

interface OperationInput {
  operationId: string;
  reason: string;
}

export interface InventoryMovementInput extends OperationInput {
  balanceId: string;
  movementType: 'opening' | 'receipt' | 'adjustment';
  quantityDelta: number;
}

export interface InventoryTransferInput extends OperationInput {
  sourceBalanceId: string;
  destinationBalanceId: string;
  quantity: number;
}

type BalanceChange = Pick<typeof inventoryMovements.$inferInsert, 'balanceId' | 'movementType' | 'quantityDelta'>;

function uuid(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new InventoryError('invalid_input', 'A valid UUID is required');
  }
  return value.toLowerCase();
}

function nonblank(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InventoryError('invalid_input', 'Reason and actor reference must be nonblank');
  }
}

function quantity(value: number): void {
  if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 2_147_483_647) {
    throw new InventoryError('invalid_input', 'Quantity must be a nonzero PostgreSQL integer');
  }
}

async function postOperation(
  db: Database, actorReference: string, input: OperationInput, changes: BalanceChange[],
) {
  nonblank(actorReference);
  nonblank(input.reason);
  const operationId = uuid(input.operationId);
  changes.sort((first, second) => first.balanceId.localeCompare(second.balanceId));

  return db.transaction(async (tx) => {
    // Serialize retries even when the operation spans different balance rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`);
    const previous = await tx.select().from(inventoryMovements)
      .where(eq(inventoryMovements.operationId, operationId)).orderBy(inventoryMovements.balanceId);
    if (previous.length > 0) {
      const matches = previous.length === changes.length && previous.every((movement, index) => {
        const change = changes[index];
        return change && movement.balanceId === change.balanceId && movement.movementType === change.movementType
          && movement.quantityDelta === change.quantityDelta && movement.reason === input.reason
          && movement.actorReference === actorReference;
      });
      if (!matches) throw new InventoryError('conflict', 'Operation ID has already been used with different data');
      return previous;
    }

    // Every operation locks balances in the same order, including opposite transfers.
    const balances = await tx.select().from(inventoryBalances)
      .where(inArray(inventoryBalances.id, changes.map((change) => change.balanceId)))
      .orderBy(inventoryBalances.id).for('update');
    if (balances.length !== changes.length) throw new InventoryError('not_found', 'Inventory balance not found');
    const [first, second] = balances;
    if (first && second && (first.productId !== second.productId || first.lotId !== second.lotId
      || first.locationId === second.locationId)) {
      throw new InventoryError('conflict', 'Transfers require the same product and lot in different locations');
    }

    for (const change of changes) {
      const balance = balances.find((row) => row.id === change.balanceId);
      if (!balance) throw new InventoryError('not_found', 'Inventory balance not found');
      if (change.movementType === 'opening') {
        const existing = await tx.select({ id: inventoryMovements.id }).from(inventoryMovements)
          .where(eq(inventoryMovements.balanceId, balance.id)).limit(1);
        if (existing.length > 0 || balance.onHandQuantity !== 0) {
          throw new InventoryError('conflict', 'Opening stock requires an unused zero balance');
        }
      }
      const nextQuantity = balance.onHandQuantity + change.quantityDelta;
      if (nextQuantity < balance.reservedQuantity) {
        throw new InventoryError('insufficient_stock', 'Insufficient unreserved physical stock');
      }
      if (nextQuantity > 2_147_483_647) throw new InventoryError('conflict', 'Balance quantity exceeds its integer range');
      await tx.update(inventoryBalances).set({ onHandQuantity: nextQuantity, updatedAt: sql`now()` })
        .where(eq(inventoryBalances.id, balance.id));
    }
    return tx.insert(inventoryMovements).values(changes.map((change) => ({
      ...change, operationId, actorReference, reason: input.reason,
    }))).returning();
  });
}

// The caller supplies the authorized backend actor, never an untrusted request field.
export async function recordInventoryMovement(db: Database, actorReference: string, input: InventoryMovementInput) {
  quantity(input.quantityDelta);
  if (!['opening', 'receipt', 'adjustment'].includes(input.movementType)
    || (input.movementType !== 'adjustment' && input.quantityDelta < 0)) {
    throw new InventoryError('invalid_input', 'Invalid movement type or quantity sign');
  }
  return postOperation(db, actorReference, input, [{
    balanceId: uuid(input.balanceId), movementType: input.movementType, quantityDelta: input.quantityDelta,
  }]);
}

export async function transferInventory(db: Database, actorReference: string, input: InventoryTransferInput) {
  quantity(input.quantity);
  const sourceBalanceId = uuid(input.sourceBalanceId);
  const destinationBalanceId = uuid(input.destinationBalanceId);
  if (input.quantity < 0 || sourceBalanceId === destinationBalanceId) {
    throw new InventoryError('invalid_input', 'A transfer needs a positive quantity and distinct balances');
  }
  return postOperation(db, actorReference, input, [
    { balanceId: sourceBalanceId, movementType: 'transfer_out', quantityDelta: -input.quantity },
    { balanceId: destinationBalanceId, movementType: 'transfer_in', quantityDelta: input.quantity },
  ]);
}

export async function getAvailableInventory(db: Database, productId: string): Promise<bigint> {
  const [result] = await db.select({
    quantity: sql<string>`coalesce(sum(${inventoryBalances.onHandQuantity} - ${inventoryBalances.reservedQuantity}), 0)::text`,
  }).from(inventoryBalances)
    .innerJoin(products, eq(products.id, inventoryBalances.productId))
    .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryBalances.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(and(eq(products.id, uuid(productId)), eligibleInventory()));
  return BigInt(result?.quantity ?? '0');
}

export function eligibleInventory() {
  return and(
    eq(inventoryLocations.isActive, true),
    eq(inventoryBalances.isBlocked, false),
    or(
      and(eq(products.inventoryTracking, 'quantity_only'), isNull(inventoryBalances.lotId)),
      and(eq(products.inventoryTracking, 'lot_and_expiration'),
        gt(inventoryLots.expiresOn, sql`(statement_timestamp() AT TIME ZONE 'America/Santiago')::date`)),
    ),
  );
}
