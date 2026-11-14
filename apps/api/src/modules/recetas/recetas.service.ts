import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@farmacia/database';
import { schema } from '@farmacia/database';
import type { EstadoReceta } from '@farmacia/database/schema';
import { ErrorHttp } from '../../errors.js';

// Formatos aceptados para la receta adjuntada (4 MB ya decodificados).
export const TIPOS_RECETA = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const TAMANO_MAXIMO_BYTES = 4 * 1024 * 1024;

export interface ArchivoReceta {
  nombre: string;
  tipo: string;
  datos: string; // base64
}

export interface ItemReceta {
  codigo: string;
  nombre: string;
  cantidad: number;
}

export interface RecetaVecino {
  id: string;
  estado: EstadoReceta;
  archivoNombre: string;
  archivoTipo: string;
  observaciones: string | null;
  revisadoPor: string | null;
  revisadoEn: string | null;
  creadoEn: string;
  venceEn: string | null;
  items: ItemReceta[];
}

export interface RecetaAdmin extends RecetaVecino {
  vecino: { id: string; nombre: string; email: string };
}

export interface EvaluacionReceta {
  estado: 'ACEPTADA' | 'RECHAZADA';
  observaciones?: string;
  items?: { codigo: string; cantidad?: number }[];
}

type FilaReceta = typeof schema.recetas.$inferSelect;

// La receta debe renovarse cada 6 meses desde que el funcionario la acepta.
export const MESES_VIGENCIA_RECETA = 6;

function sumarMeses(fecha: Date, meses: number): Date {
  const resultado = new Date(fecha);
  const dia = resultado.getDate();
  resultado.setDate(1);
  resultado.setMonth(resultado.getMonth() + meses);
  const ultimoDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate();
  resultado.setDate(Math.min(dia, ultimoDia));
  return resultado;
}

// Fecha de vencimiento de una receta aceptada; null si aún no aplica.
export function vencimientoReceta(receta: {
  estado: string;
  creadoEn: Date;
  revisadoEn: Date | null;
}): Date | null {
  if (receta.estado !== 'ACEPTADA') return null;
  return sumarMeses(receta.revisadoEn ?? receta.creadoEn, MESES_VIGENCIA_RECETA);
}

export function recetaVigente(
  receta: { estado: string; creadoEn: Date; revisadoEn: Date | null },
  ahora: Date = new Date(),
): boolean {
  const vence = vencimientoReceta(receta);
  return vence !== null && vence.getTime() > ahora.getTime();
}

function aReceta(fila: FilaReceta, items: ItemReceta[]): RecetaVecino {
  return {
    id: fila.id,
    estado: fila.estado as EstadoReceta,
    archivoNombre: fila.archivoNombre,
    archivoTipo: fila.archivoTipo,
    observaciones: fila.observaciones,
    revisadoPor: fila.revisadoPor,
    revisadoEn: fila.revisadoEn?.toISOString() ?? null,
    creadoEn: fila.creadoEn.toISOString(),
    venceEn: vencimientoReceta({
      estado: fila.estado as EstadoReceta,
      creadoEn: fila.creadoEn,
      revisadoEn: fila.revisadoEn,
    })?.toISOString() ?? null,
    items,
  };
}

async function itemsDe(db: Database, recetaIds: string[]): Promise<Map<string, ItemReceta[]>> {
  const mapa = new Map<string, ItemReceta[]>();
  if (recetaIds.length === 0) return mapa;
  const filas = await db
    .select()
    .from(schema.recetaItems)
    .where(inArray(schema.recetaItems.recetaId, recetaIds))
    .orderBy(asc(schema.recetaItems.nombre));
  for (const fila of filas) {
    const lista = mapa.get(fila.recetaId) ?? [];
    lista.push({ codigo: fila.codigo, nombre: fila.nombre, cantidad: fila.cantidad });
    mapa.set(fila.recetaId, lista);
  }
  return mapa;
}

// Valida el archivo antes de guardar: tipo admitido y tamaño máximo.
function decodificarArchivo(archivo: ArchivoReceta): string {
  if (!(TIPOS_RECETA as readonly string[]).includes(archivo.tipo)) {
    throw new ErrorHttp(400, 'La receta debe ser un PDF, JPG o PNG.');
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(archivo.datos)) {
    throw new ErrorHttp(400, 'El archivo de la receta no es válido.');
  }
  const bytes = Buffer.from(archivo.datos, 'base64');
  if (bytes.length === 0) throw new ErrorHttp(400, 'El archivo de la receta está vacío.');
  if (bytes.length > TAMANO_MAXIMO_BYTES) {
    throw new ErrorHttp(400, 'La receta supera el máximo de 4 MB.');
  }
  return bytes.toString('base64');
}

// El vecino adjunta su receta médica: queda PENDIENTE hasta que un
// funcionario la revise en el panel.
export async function subirReceta(
  db: Database,
  vecinoId: string,
  archivo: ArchivoReceta,
): Promise<RecetaVecino> {
  const datos = decodificarArchivo(archivo);
  const [fila] = await db
    .insert(schema.recetas)
    .values({
      vecinoId,
      archivoNombre: archivo.nombre.trim().slice(0, 120),
      archivoTipo: archivo.tipo,
      archivoDatos: datos,
    })
    .returning();
  if (!fila) throw new ErrorHttp(500, 'No se pudo guardar la receta.');
  return aReceta(fila, []);
}

// Recetas del vecino, más recientes primero (sin el archivo).
export async function listarRecetasVecino(
  db: Database,
  vecinoId: string,
): Promise<RecetaVecino[]> {
  const filas = await db
    .select()
    .from(schema.recetas)
    .where(eq(schema.recetas.vecinoId, vecinoId))
    .orderBy(desc(schema.recetas.creadoEn));
  const items = await itemsDe(db, filas.map((f) => f.id));
  return filas.map((f) => aReceta(f, items.get(f.id) ?? []));
}

// Cola de revisión del panel de funcionarios, con los datos del vecino.
export async function listarRecetasAdmin(
  db: Database,
  estado?: EstadoReceta,
): Promise<RecetaAdmin[]> {
  const filas = await db
    .select({
      receta: schema.recetas,
      vecino: schema.vecinos,
    })
    .from(schema.recetas)
    .innerJoin(schema.vecinos, eq(schema.recetas.vecinoId, schema.vecinos.id))
    .where(estado ? eq(schema.recetas.estado, estado) : undefined)
    .orderBy(desc(schema.recetas.creadoEn));

  const items = await itemsDe(db, filas.map((f) => f.receta.id));
  return filas.map((f) => ({
    ...aReceta(f.receta, items.get(f.receta.id) ?? []),
    vecino: { id: f.vecino.id, nombre: f.vecino.nombre, email: f.vecino.email },
  }));
}

// Archivo original para que el funcionario lo vea en el panel.
export async function archivoReceta(
  db: Database,
  id: string,
): Promise<ArchivoReceta> {
  const [fila] = await db
    .select({
      archivoNombre: schema.recetas.archivoNombre,
      archivoTipo: schema.recetas.archivoTipo,
      archivoDatos: schema.recetas.archivoDatos,
    })
    .from(schema.recetas)
    .where(eq(schema.recetas.id, id))
    .limit(1);
  if (!fila) throw new ErrorHttp(404, 'Receta no encontrada.');
  return { nombre: fila.archivoNombre, tipo: fila.archivoTipo, datos: fila.archivoDatos };
}

// Revisión del funcionario: al aceptar debe indicar qué medicamentos cubre
// la receta; con eso el vecino puede comprar solo esos.
export async function evaluarReceta(
  db: Database,
  id: string,
  evaluacion: EvaluacionReceta,
  responsable: string,
): Promise<RecetaVecino> {
  const [receta] = await db
    .select()
    .from(schema.recetas)
    .where(eq(schema.recetas.id, id))
    .limit(1);
  if (!receta) throw new ErrorHttp(404, 'Receta no encontrada.');
  if (receta.estado !== 'PENDIENTE') {
    throw new ErrorHttp(409, 'Esta receta ya fue revisada.');
  }

  let items: ItemReceta[] = [];
  if (evaluacion.estado === 'ACEPTADA') {
    const solicitados = evaluacion.items ?? [];
    if (solicitados.length === 0) {
      throw new ErrorHttp(400, 'Indica los medicamentos que indica la receta.');
    }
    const codigos = solicitados.map((i) => i.codigo);
    const medicamentos = await db
      .select({
        codigo: schema.medicamentos.codigo,
        principioActivo: schema.medicamentos.principioActivo,
      })
      .from(schema.medicamentos)
      .where(inArray(schema.medicamentos.codigo, codigos));

    const porCodigo = new Map(medicamentos.map((m) => [m.codigo, m]));
    items = solicitados.map((i) => {
      const med = porCodigo.get(i.codigo);
      if (!med) {
        throw new ErrorHttp(400, `El medicamento ${i.codigo} no existe en el catálogo.`);
      }
      return {
        codigo: med.codigo,
        nombre: med.principioActivo,
        cantidad: i.cantidad ?? 1,
      };
    });
  }

  const revisadoEn = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.recetas)
      .set({
        estado: evaluacion.estado,
        observaciones: evaluacion.observaciones?.trim() || null,
        revisadoPor: responsable,
        revisadoEn,
      })
      .where(eq(schema.recetas.id, id));
    await tx.delete(schema.recetaItems).where(eq(schema.recetaItems.recetaId, id));
    if (items.length > 0) {
      await tx.insert(schema.recetaItems).values(
        items.map((item) => ({ recetaId: id, ...item })),
      );
    }
  });

  return aReceta(
    { ...receta, estado: evaluacion.estado, revisadoPor: responsable, revisadoEn },
    items,
  );
}

// Recetas aceptadas y vigentes del vecino con sus medicamentos autorizados.
// Al superar los 6 meses de vigencia dejan de cubrir medicamentos.
export async function recetasAceptadas(
  db: Database,
  vecinoId: string,
): Promise<ItemReceta[][]> {
  const filas = await db
    .select()
    .from(schema.recetas)
    .where(and(eq(schema.recetas.vecinoId, vecinoId), eq(schema.recetas.estado, 'ACEPTADA')));
  const vigentes = filas.filter((fila) => recetaVigente(fila));
  const items = await itemsDe(db, vigentes.map((f) => f.id));
  return vigentes.map((f) => items.get(f.id) ?? []);
}

// Regla de compra: todo medicamento "requiere receta" debe estar indicado en
// una receta aceptada, con la cantidad autorizada suficiente. Devuelve el
// motivo del rechazo o null si el pedido puede avanzar.
export function validarCoberturaReceta(
  items: { codigo: string; nombre: string; cantidad: number }[],
  recetasAceptadas: ItemReceta[][],
): string | null {
  const autorizado = new Map<string, number>();
  for (const receta of recetasAceptadas) {
    for (const item of receta) {
      autorizado.set(item.codigo, (autorizado.get(item.codigo) ?? 0) + item.cantidad);
    }
  }

  for (const item of items) {
    const cubierta = autorizado.get(item.codigo) ?? 0;
    if (cubierta === 0) {
      return `No puedes comprar ${item.nombre}: no está indicado en tu receta médica aprobada.`;
    }
    if (cubierta < item.cantidad) {
      return `No puedes comprar ${item.nombre}: tu receta solo autoriza ${cubierta} unidad(es).`;
    }
  }
  return null;
}
