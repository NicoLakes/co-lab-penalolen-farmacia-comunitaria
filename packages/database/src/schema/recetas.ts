import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vecinos } from './vecinos.js';

// Estados de la revisión de una receta subida por el vecino (HU recetas).
export const ESTADOS_RECETA = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA'] as const;

export type EstadoReceta = (typeof ESTADOS_RECETA)[number];

// Receta médica adjuntada desde la cuenta del vecino.
// El archivo viaja en la propia base; el funcionario la revisa en el panel.
export const recetas = pgTable(
  'recetas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vecinoId: uuid('vecino_id')
      .notNull()
      .references(() => vecinos.id, { onDelete: 'cascade' }),
    archivoNombre: text('archivo_nombre').notNull(),
    archivoTipo: text('archivo_tipo').notNull(),
    archivoDatos: text('archivo_datos').notNull(),
    estado: text('estado').notNull().default('PENDIENTE'),
    observaciones: text('observaciones'),
    revisadoPor: text('revisado_por'),
    revisadoEn: timestamp('revisado_en', { withTimezone: true }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('recetas_estado_valido', sql`${t.estado} in ('PENDIENTE', 'ACEPTADA', 'RECHAZADA')`),
  ],
);

// Lo que el funcionario identifica en la receta: medicamentos autorizados.
export const recetaItems = pgTable(
  'receta_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recetaId: uuid('receta_id')
      .notNull()
      .references(() => recetas.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    cantidad: integer('cantidad').notNull().default(1),
  },
  (t) => [check('receta_items_cantidad_positiva', sql`${t.cantidad} > 0`)],
);
