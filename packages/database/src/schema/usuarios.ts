import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Usuarios funcionarios/admin con contraseña hasheada (scrypt) para el panel.
export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    nombre: text('nombre').notNull(),
    passwordHash: text('password_hash').notNull(),
    rol: text('rol').notNull().default('funcionario'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check('usuarios_rol_valido', sql`${t.rol} in ('admin', 'funcionario')`)],
);

// Sesiones por token aleatorio: en la cookie va el token, aquí se guarda su hash.
export const sesiones = pgTable('sesiones', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  usuarioId: uuid('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  creadaEn: timestamp('creada_en', { withTimezone: true }).defaultNow().notNull(),
  expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
});
