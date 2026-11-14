import { boolean, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Catálogo de medicamentos: fuente única de precios, stock y estado de alta/baja.
export const medicamentos = pgTable(
  'medicamentos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    codigo: text('codigo').notNull().unique(),
    principioActivo: text('principio_activo').notNull(),
    descriptor: text('descriptor').notNull(),
    formaFarmaceutica: text('forma_farmaceutica').notNull(),
    presentacion: text('presentacion').notNull(),
    proveedor: text('proveedor').notNull(),
    clasificacionTerapeutica: text('clasificacion_terapeutica').notNull(),
    precio: integer('precio').notNull(),
    stock: integer('stock').notNull(),
    requiereReceta: boolean('requiere_receta').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('medicamentos_precio_positivo', sql`${t.precio} >= 0`),
    check('medicamentos_stock_no_negativo', sql`${t.stock} >= 0`),
  ],
);
