import { asc, eq } from 'drizzle-orm';
import type { Database } from '@farmacia/database';
import { schema } from '@farmacia/database';
import { ErrorHttp } from '../../errors.js';

export interface MedicamentoPublico {
  codigo: string;
  principioActivo: string;
  descriptor: string;
  formaFarmaceutica: string;
  presentacion: string;
  proveedor: string;
  clasificacionTerapeutica: string;
  precio: number;
  stock: number;
  requiereReceta: boolean;
}

export interface MedicamentoAdmin extends MedicamentoPublico {
  id: string;
  activo: boolean;
}

export interface DatosMedicamento {
  codigo: string;
  principioActivo: string;
  descriptor: string;
  formaFarmaceutica: string;
  presentacion: string;
  proveedor: string;
  clasificacionTerapeutica: string;
  precio: number;
  stock: number;
  requiereReceta: boolean;
}

type Fila = typeof schema.medicamentos.$inferSelect;

function aPublico(fila: Fila): MedicamentoPublico {
  return {
    codigo: fila.codigo,
    principioActivo: fila.principioActivo,
    descriptor: fila.descriptor,
    formaFarmaceutica: fila.formaFarmaceutica,
    presentacion: fila.presentacion,
    proveedor: fila.proveedor,
    clasificacionTerapeutica: fila.clasificacionTerapeutica,
    precio: fila.precio,
    stock: fila.stock,
    requiereReceta: fila.requiereReceta,
  };
}

function aAdmin(fila: Fila): MedicamentoAdmin {
  return { id: fila.id, activo: fila.activo, ...aPublico(fila) };
}

// Catálogo del vecino: solo medicamentos activos.
export async function listarPublicos(db: Database): Promise<MedicamentoPublico[]> {
  const filas = await db
    .select()
    .from(schema.medicamentos)
    .where(eq(schema.medicamentos.activo, true))
    .orderBy(asc(schema.medicamentos.principioActivo));
  return filas.map(aPublico);
}

// Vista de gestión: incluye dados de baja para el panel.
export async function listarAdmin(db: Database): Promise<MedicamentoAdmin[]> {
  const filas = await db
    .select()
    .from(schema.medicamentos)
    .orderBy(asc(schema.medicamentos.principioActivo));
  return filas.map(aAdmin);
}

export async function crearMedicamento(
  db: Database,
  datos: DatosMedicamento,
): Promise<MedicamentoAdmin> {
  const existente = await db
    .select({ id: schema.medicamentos.id })
    .from(schema.medicamentos)
    .where(eq(schema.medicamentos.codigo, datos.codigo))
    .limit(1);
  if (existente.length > 0) {
    throw new ErrorHttp(409, `Ya existe un medicamento con el código ${datos.codigo}.`);
  }

  const [fila] = await db
    .insert(schema.medicamentos)
    .values({ ...datos, codigo: datos.codigo.trim() })
    .returning();
  if (!fila) throw new ErrorHttp(500, 'No se pudo crear el medicamento.');
  return aAdmin(fila);
}

export async function actualizarMedicamento(
  db: Database,
  id: string,
  cambios: Partial<Pick<DatosMedicamento, 'precio' | 'stock' | 'requiereReceta'>>,
): Promise<MedicamentoAdmin> {
  const [fila] = await db
    .update(schema.medicamentos)
    .set({ ...cambios, actualizadoEn: new Date() })
    .where(eq(schema.medicamentos.id, id))
    .returning();
  if (!fila) throw new ErrorHttp(404, 'Medicamento no encontrado.');
  return aAdmin(fila);
}

// Baja lógica: el medicamento desaparece del catálogo del vecino.
export async function darDeBaja(db: Database, id: string): Promise<MedicamentoAdmin> {
  const [fila] = await db
    .update(schema.medicamentos)
    .set({ activo: false, actualizadoEn: new Date() })
    .where(eq(schema.medicamentos.id, id))
    .returning();
  if (!fila) throw new ErrorHttp(404, 'Medicamento no encontrado.');
  return aAdmin(fila);
}

// Eliminación definitiva: solo para medicamentos ya dados de baja.
export async function eliminarMedicamento(db: Database, id: string): Promise<void> {
  const [fila] = await db
    .select({ activo: schema.medicamentos.activo })
    .from(schema.medicamentos)
    .where(eq(schema.medicamentos.id, id))
    .limit(1);
  if (!fila) throw new ErrorHttp(404, 'Medicamento no encontrado.');
  if (fila.activo) throw new ErrorHttp(409, 'Da de baja el medicamento antes de eliminarlo.');

  await db.delete(schema.medicamentos).where(eq(schema.medicamentos.id, id));
}

export async function reactivar(db: Database, id: string): Promise<MedicamentoAdmin> {
  const [fila] = await db
    .update(schema.medicamentos)
    .set({ activo: true, actualizadoEn: new Date() })
    .where(eq(schema.medicamentos.id, id))
    .returning();
  if (!fila) throw new ErrorHttp(404, 'Medicamento no encontrado.');
  return aAdmin(fila);
}
