import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '@farmacia/database';
import { schema } from '@farmacia/database';
import { ErrorHttp } from '../../errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

// Cookie propia del vecino: no se mezcla con la sesión del panel de funcionarios.
export const COOKIE_VECINO = 'farmacia_vecino';
const DURACION_SEGUNDOS = 7 * 24 * 60 * 60;

export interface VecinoSesion {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  direccion: string | null;
}

export interface DatosRegistro {
  nombre: string;
  email: string;
  telefono: string;
  direccion: string;
  password: string;
}

// Datos editables desde "Mi cuenta"; al menos uno debe venir.
export interface DatosActualizacion {
  nombre?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function duracionSesionVecinoSegundos(): number {
  return DURACION_SEGUNDOS;
}

function esEmailDuplicado(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

async function crearSesion(
  db: Database,
  vecinoId: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(schema.vecinoSesiones).values({
    tokenHash: hashToken(token),
    vecinoId,
    expiraEn: new Date(Date.now() + DURACION_SEGUNDOS * 1000),
  });
  return token;
}

// Registro de la cuenta del vecino (HU-03): crea el usuario y su sesión.
// Pide de una vez los datos que después usa el checkout (teléfono y dirección).
export async function registrarVecino(
  db: Database,
  datos: DatosRegistro,
): Promise<{ token: string; vecino: VecinoSesion }> {
  const email = datos.email.trim().toLowerCase();
  try {
    const [vecino] = await db
      .insert(schema.vecinos)
      .values({
        nombre: datos.nombre.trim(),
        email,
        telefono: datos.telefono.trim(),
        direccion: datos.direccion.trim(),
        passwordHash: await hashPassword(datos.password),
      })
      .returning({
        id: schema.vecinos.id,
        nombre: schema.vecinos.nombre,
        email: schema.vecinos.email,
        telefono: schema.vecinos.telefono,
        direccion: schema.vecinos.direccion,
      });
    if (!vecino) throw new ErrorHttp(500, 'No se pudo crear la cuenta.');
    const token = await crearSesion(db, vecino.id);
    return { token, vecino };
  } catch (error: unknown) {
    if (esEmailDuplicado(error)) {
      throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo.');
    }
    throw error;
  }
}

// Actualiza los datos de la cuenta del vecino (editables desde Mi cuenta).
export async function actualizarVecino(
  db: Database,
  vecinoId: string,
  cambios: DatosActualizacion,
): Promise<VecinoSesion> {
  const valores: Partial<typeof schema.vecinos.$inferInsert> = {};
  if (cambios.nombre !== undefined) valores.nombre = cambios.nombre.trim();
  if (cambios.email !== undefined) valores.email = cambios.email.trim().toLowerCase();
  if (cambios.telefono !== undefined) valores.telefono = cambios.telefono.trim();
  if (cambios.direccion !== undefined) valores.direccion = cambios.direccion.trim();
  if (Object.keys(valores).length === 0) {
    throw new ErrorHttp(400, 'No hay datos para actualizar.');
  }

  try {
    const [vecino] = await db
      .update(schema.vecinos)
      .set(valores)
      .where(eq(schema.vecinos.id, vecinoId))
      .returning({
        id: schema.vecinos.id,
        nombre: schema.vecinos.nombre,
        email: schema.vecinos.email,
        telefono: schema.vecinos.telefono,
        direccion: schema.vecinos.direccion,
      });
    if (!vecino) throw new ErrorHttp(404, 'Cuenta no encontrada.');
    return vecino;
  } catch (error: unknown) {
    if (esEmailDuplicado(error)) {
      throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo.');
    }
    throw error;
  }
}

// Valida credenciales del vecino y crea su sesión.
export async function iniciarSesionVecino(
  db: Database,
  email: string,
  password: string,
): Promise<{ token: string; vecino: VecinoSesion } | null> {
  const [vecino] = await db
    .select()
    .from(schema.vecinos)
    .where(eq(schema.vecinos.email, email.trim().toLowerCase()))
    .limit(1);

  if (!vecino) return null;
  if (!(await verifyPassword(password, vecino.passwordHash))) return null;

  const token = await crearSesion(db, vecino.id);
  return {
    token,
    vecino: {
      id: vecino.id,
      nombre: vecino.nombre,
      email: vecino.email,
      telefono: vecino.telefono,
      direccion: vecino.direccion,
    },
  };
}

// Resuelve el vecino dueño de un token de sesión vigente, si existe.
export async function vecinoDeToken(
  db: Database,
  token: string,
): Promise<VecinoSesion | null> {
  const [fila] = await db
    .select({
      id: schema.vecinos.id,
      nombre: schema.vecinos.nombre,
      email: schema.vecinos.email,
      telefono: schema.vecinos.telefono,
      direccion: schema.vecinos.direccion,
    })
    .from(schema.vecinoSesiones)
    .innerJoin(schema.vecinos, eq(schema.vecinoSesiones.vecinoId, schema.vecinos.id))
    .where(
      and(
        eq(schema.vecinoSesiones.tokenHash, hashToken(token)),
        gt(schema.vecinoSesiones.expiraEn, new Date()),
      ),
    )
    .limit(1);

  return fila ?? null;
}

export async function cerrarSesionVecino(db: Database, token: string): Promise<void> {
  await db
    .delete(schema.vecinoSesiones)
    .where(eq(schema.vecinoSesiones.tokenHash, hashToken(token)));
}
