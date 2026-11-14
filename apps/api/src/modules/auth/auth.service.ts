import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '@farmacia/database';
import { schema } from '@farmacia/database';
import { verifyPassword } from './password.js';

export const COOKIE_SESION = 'farmacia_sesion';
const DURACION_SEGUNDOS = 7 * 24 * 60 * 60;

export type Rol = 'admin' | 'funcionario';

export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function duracionSesionSegundos(): number {
  return DURACION_SEGUNDOS;
}

// Valida credenciales y crea una sesión; devuelve el token para la cookie.
export async function iniciarSesion(
  db: Database,
  email: string,
  password: string,
): Promise<{ token: string; usuario: UsuarioSesion } | null> {
  const [usuario] = await db
    .select()
    .from(schema.usuarios)
    .where(eq(schema.usuarios.email, email.trim().toLowerCase()))
    .limit(1);

  if (!usuario || !usuario.activo) return null;
  if (!(await verifyPassword(password, usuario.passwordHash))) return null;

  const token = randomBytes(32).toString('base64url');
  await db.insert(schema.sesiones).values({
    tokenHash: hashToken(token),
    usuarioId: usuario.id,
    expiraEn: new Date(Date.now() + DURACION_SEGUNDOS * 1000),
  });

  return {
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol as Rol },
  };
}

// Resuelve el usuario dueño de un token de sesión vigente, si existe.
export async function usuarioDeToken(db: Database, token: string): Promise<UsuarioSesion | null> {
  const [fila] = await db
    .select({
      id: schema.usuarios.id,
      nombre: schema.usuarios.nombre,
      email: schema.usuarios.email,
      rol: schema.usuarios.rol,
      activo: schema.usuarios.activo,
    })
    .from(schema.sesiones)
    .innerJoin(schema.usuarios, eq(schema.sesiones.usuarioId, schema.usuarios.id))
    .where(
      and(
        eq(schema.sesiones.tokenHash, hashToken(token)),
        gt(schema.sesiones.expiraEn, new Date()),
      ),
    )
    .limit(1);

  if (!fila || !fila.activo) return null;
  return { id: fila.id, nombre: fila.nombre, email: fila.email, rol: fila.rol as Rol };
}

export async function cerrarSesion(db: Database, token: string): Promise<void> {
  await db.delete(schema.sesiones).where(eq(schema.sesiones.tokenHash, hashToken(token)));
}
