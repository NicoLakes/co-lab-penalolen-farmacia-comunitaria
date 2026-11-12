import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { escapeIdentifier } from 'pg';
import { createDatabase } from '../../src/index.js';
import {
  inventoryLocations, inventorySnapshots, monthlyProductConsumption,
  productSaleCondition, products, suppliers, therapeuticCategories,
} from '../../src/schema/index.js';

function hasDatabaseCode(code: string) {
  return (error: unknown): boolean => {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code;
  };
}

test('the schema preserves catalog relationships and historical data integrity', async (t) => {
  const { db, pool } = createDatabase({ onPoolError: (error) => { throw error; } });
  t.after(() => pool.end());
  const suffix = randomUUID();

  await assert.rejects(db.transaction(async (tx) => {
    const [supplier] = await tx.insert(suppliers).values({ name: `Supplier ${suffix}` }).returning();
    const [category] = await tx.insert(therapeuticCategories).values({ name: `Category ${suffix}` }).returning();
    const [location] = await tx.insert(inventoryLocations)
      .values({ code: suffix, name: `Location ${suffix}` }).returning();
    assert.ok(supplier && category && location);

    const [product] = await tx.insert(products).values({
      code: suffix,
      name: 'Catalog reference product',
      description: 'Catalog reference product',
      quantityUnit: 'package',
      supplierId: supplier.id,
      therapeuticCategoryId: category.id,
    }).returning();
    assert.ok(product);
    assert.equal(product.saleCondition, null);
    assert.equal(product.activeIngredient, null);

    const source = {
      sourceSha256: '0'.repeat(64), sourceSheet: 'Reference', sourceRow: 2,
    };
    const consumption = { productId: product.id, period: '2026-08-01', sourceQuantity: -12, ...source };
    const snapshot = {
      productId: product.id, locationId: location.id, observedOn: '2026-09-08', quantity: 20, ...source,
    };
    await tx.insert(inventorySnapshots).values(snapshot);
    await tx.insert(monthlyProductConsumption).values(consumption);
    await tx.insert(monthlyProductConsumption)
      .values({ ...consumption, period: '2026-07-01', sourceQuantity: 2 });

    const rows = await tx.select({ quantity: monthlyProductConsumption.sourceQuantity })
      .from(monthlyProductConsumption).where(eq(monthlyProductConsumption.productId, product.id))
      .orderBy(monthlyProductConsumption.period);
    assert.deepEqual(rows, [{ quantity: 2 }, { quantity: -12 }]);

    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(products).values({ code: product.code, name: 'Duplicate', quantityUnit: 'package' });
    }), hasDatabaseCode('23505'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(suppliers).values({ name: `  SUPPLIER ${suffix}  ` });
    }), hasDatabaseCode('23505'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(products).values({ code: ' ', name: 'Invalid code', quantityUnit: 'package' });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(products).values({ code: randomUUID(), name: 'Product', description: ' ', quantityUnit: 'package' });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(products).values({
        code: randomUUID(), name: 'Orphan', quantityUnit: 'package', supplierId: randomUUID(),
      });
    }), hasDatabaseCode('23503'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.delete(suppliers).where(eq(suppliers.id, supplier.id));
    }), hasDatabaseCode('23503'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.delete(products).where(eq(products.id, product.id));
    }), hasDatabaseCode('23503'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(inventorySnapshots).values({ ...snapshot, observedOn: '2026-09-09', quantity: -1 });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(products).values({ code: randomUUID(), name: 'Invalid unit', quantityUnit: ' ' });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(inventorySnapshots).values(snapshot);
    }), hasDatabaseCode('23505'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(monthlyProductConsumption).values(consumption);
    }), hasDatabaseCode('23505'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(monthlyProductConsumption).values({ ...consumption, period: '2026-08-02' });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(monthlyProductConsumption)
        .values({ ...consumption, period: '2026-06-01', sourceSha256: 'invalid' });
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.insert(monthlyProductConsumption)
        .values({ ...consumption, period: '2026-06-01', sourceRow: 0 });
    }), hasDatabaseCode('23514'));

    tx.rollback();
  }), TransactionRollbackError);

  assert.deepEqual(await db.select().from(products).where(eq(products.code, suffix)), []);
});

test('commercial products require valid prices and reviewed sale conditions before publication', async (t) => {
  const { db, pool } = createDatabase({ onPoolError: (error) => { throw error; } });
  t.after(() => pool.end());
  const code = randomUUID();

  await assert.rejects(db.transaction(async (tx) => {
    const [product] = await tx.insert(products).values({
      code, name: 'Commercial product', quantityUnit: 'package',
    }).returning();
    assert.ok(product);
    assert.equal(product.description, null);
    assert.equal(product.priceClp, null);
    assert.equal(product.saleCondition, null);
    assert.equal(product.isPublished, false);

    for (const priceClp of [-1, 0]) {
      await assert.rejects(tx.transaction(async (nested) => {
        await nested.update(products).set({ priceClp }).where(eq(products.id, product.id));
      }), hasDatabaseCode('23514'), `Reject price ${priceClp}`);
    }
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ priceClp: 12.5 }).where(eq(products.id, product.id));
    }), hasDatabaseCode('22P02'));

    for (const name of ['', ' ', '\t\n']) {
      await assert.rejects(tx.transaction(async (nested) => {
        await nested.update(products).set({ name }).where(eq(products.id, product.id));
      }), hasDatabaseCode('23514'));
    }
    for (const description of ['', ' ', '\t\n']) {
      await assert.rejects(tx.transaction(async (nested) => {
        await nested.update(products).set({ description }).where(eq(products.id, product.id));
      }), hasDatabaseCode('23514'));
    }
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`INSERT INTO ${products} (code, quantity_unit) VALUES (${randomUUID()}, 'package')`);
    }), hasDatabaseCode('23502'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`UPDATE ${products} SET is_published = NULL WHERE id = ${product.id}`);
    }), hasDatabaseCode('23502'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`UPDATE ${products} SET sale_condition = ${'unknown'} WHERE id = ${product.id}`);
    }), hasDatabaseCode('22P02'));

    for (const saleCondition of productSaleCondition.enumValues) {
      assert.deepEqual(await tx.update(products).set({ saleCondition })
        .where(eq(products.id, product.id)).returning({ saleCondition: products.saleCondition }),
      [{ saleCondition }]);
    }
    await tx.update(products).set({ saleCondition: null }).where(eq(products.id, product.id));

    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ isPublished: true }).where(eq(products.id, product.id));
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ isPublished: true, priceClp: 1490 })
        .where(eq(products.id, product.id));
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ isPublished: true, saleCondition: 'direct_sale' })
        .where(eq(products.id, product.id));
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.execute(sql`UPDATE ${products} SET requires_prescription = true WHERE id = ${product.id}`);
    }), hasDatabaseCode('42703'));

    for (const saleCondition of ['direct_sale', 'simple_prescription', 'retained_prescription'] as const) {
      assert.deepEqual(await tx.update(products)
        .set({ isPublished: true, priceClp: 1490, saleCondition })
        .where(eq(products.id, product.id)).returning({
          isPublished: products.isPublished, priceClp: products.priceClp, saleCondition: products.saleCondition,
        }), [{ isPublished: true, priceClp: 1490, saleCondition }]);
    }
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ priceClp: null }).where(eq(products.id, product.id));
    }), hasDatabaseCode('23514'));
    await assert.rejects(tx.transaction(async (nested) => {
      await nested.update(products).set({ saleCondition: null }).where(eq(products.id, product.id));
    }), hasDatabaseCode('23514'));

    const [unpublished] = await tx.update(products)
      .set({ isPublished: false, priceClp: null, saleCondition: null, description: 'Additional details' })
      .where(eq(products.id, product.id)).returning();
    assert.equal(unpublished?.isPublished, false);
    assert.equal(unpublished?.priceClp, null);
    assert.equal(unpublished?.saleCondition, null);
    assert.equal(unpublished?.description, 'Additional details');
    tx.rollback();
  }), TransactionRollbackError);

  assert.deepEqual(await db.select().from(products).where(eq(products.code, code)), []);
});

test('a fresh migration chain creates catalog and operational inventory without legacy fields', async (t) => {
  const { db, pool } = createDatabase({ onPoolError: (error) => { throw error; } });
  t.after(() => pool.end());
  const namespace = `catalog_migration_${randomUUID().replaceAll('-', '')}`;
  const migrationFiles = [
    '0000_initial_catalog.sql', '0001_commercial_catalog.sql', '0002_operational_inventory.sql',
    '0003_orders_and_reservations.sql', '0004_authentication.sql',
  ];
  const migrations = await Promise.all(migrationFiles.map((filename) =>
    readFile(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8')));

  await assert.rejects(db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA ${sql.identifier(namespace)}`);
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(namespace)}`);
    // Relocate only schema qualifiers so migration tests cannot alter application tables.
    for (const migration of migrations) {
      await tx.execute(sql.raw(migration.replaceAll('"public".', `${escapeIdentifier(namespace)}.`)));
    }
    const [product] = await tx.insert(products).values({
      code: 'NEW-PRODUCT', name: 'New product', quantityUnit: 'package',
    }).returning();
    assert.ok(product);
    assert.equal(product.name, 'New product');
    assert.equal(product.description, null);
    assert.equal(product.saleCondition, null);
    assert.equal(product.priceClp, null);
    assert.equal(product.isPublished, false);
    assert.equal(product.inventoryTracking, null);
    const removedColumns = await tx.execute(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${namespace} AND table_name = 'products'
      AND column_name IN ('requires_prescription', 'legacy_requires_prescription')`);
    assert.equal(removedColumns.rows.length, 0);
    tx.rollback();
  }), TransactionRollbackError);

  const remaining = await db.execute(sql`SELECT nspname FROM pg_namespace WHERE nspname = ${namespace}`);
  assert.equal(remaining.rows.length, 0);
});
