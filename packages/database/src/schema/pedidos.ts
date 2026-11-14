import { check, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vecinos } from './vecinos.js';

// Estados del ciclo de vida de un pedido (HU-10 / HU-11).
export const ESTADOS_PEDIDO = [
  'RECIBIDO',
  'EN_PREPARACION',
  'LISTO_PARA_RETIRO',
  'EN_DESPACHO',
  'ENTREGADO',
  'CANCELADO',
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const MODALIDADES_PEDIDO = ['RETIRO', 'DELIVERY'] as const;

export type ModalidadPedido = (typeof MODALIDADES_PEDIDO)[number];

// Ítem congelado del catálogo al momento del checkout.
export interface ItemPedido {
  codigo: string;
  nombre: string;
  precio: number;
  cantidad: number;
}

export const pedidos = pgTable(
  'pedidos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    numero: serial('numero'),
    clienteNombre: text('cliente_nombre').notNull(),
    contacto: text('contacto').notNull(),
    modalidad: text('modalidad').notNull(),
    direccion: text('direccion'),
    estado: text('estado').notNull().default('RECIBIDO'),
    items: jsonb('items').$type<ItemPedido[]>().notNull(),
    total: integer('total').notNull(),
    // Cuenta del vecino dueña del pedido, si estaba con sesión al hacer checkout (HU-03).
    vecinoId: uuid('vecino_id').references(() => vecinos.id, { onDelete: 'set null' }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('pedidos_modalidad_valida', sql`${t.modalidad} in ('RETIRO', 'DELIVERY')`),
    check('pedidos_estado_valido', sql`${t.estado} in ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'EN_DESPACHO', 'ENTREGADO', 'CANCELADO')`),
    check('pedidos_total_no_negativo', sql`${t.total} >= 0`),
    check(
      'pedidos_direccion_requerida_en_delivery',
      sql`(${t.modalidad} = 'DELIVERY' AND ${t.direccion} IS NOT NULL) OR ${t.modalidad} = 'RETIRO'`,
    ),
  ],
);

// Historial de cambios de estado con responsable y momento exacto.
export const pedidoHistorial = pgTable(
  'pedido_historial',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade' }),
    estado: text('estado').notNull(),
    responsable: text('responsable').notNull(),
    registradoEn: timestamp('registrado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('pedido_historial_estado_valido', sql`${t.estado} in ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'EN_DESPACHO', 'ENTREGADO', 'CANCELADO')`),
  ],
);
