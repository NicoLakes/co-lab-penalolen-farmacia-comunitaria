import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Cuentas del vecino (HU-03): registro e inicio de sesión para asociar sus pedidos.
// Teléfono y dirección se piden al crear la cuenta para no volver a pedirlos
// en el checkout; son editables desde "Mi cuenta".
export const vecinos = pgTable('vecinos', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  nombre: text('nombre').notNull(),
  telefono: text('telefono'),
  direccion: text('direccion'),
  passwordHash: text('password_hash').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
});

// Sesiones del vecino: en la cookie va el token, aquí se guarda su hash.
export const vecinoSesiones = pgTable('vecino_sesiones', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  vecinoId: uuid('vecino_id')
    .notNull()
    .references(() => vecinos.id, { onDelete: 'cascade' }),
  creadaEn: timestamp('creada_en', { withTimezone: true }).defaultNow().notNull(),
  expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
});
