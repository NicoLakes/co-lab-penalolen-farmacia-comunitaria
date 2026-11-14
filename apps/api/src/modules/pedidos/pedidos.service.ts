import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from '@farmacia/database';
import { schema } from '@farmacia/database';
import type { EstadoPedido, ItemPedido, ModalidadPedido } from '@farmacia/database/schema';
import { ErrorHttp } from '../../errors.js';
import { recetasAceptadas, validarCoberturaReceta } from '../recetas/recetas.service.js';

export interface ItemSolicitud {
  codigo: string;
  cantidad: number;
}

export interface SolicitudPedido {
  clienteNombre: string;
  contacto: string;
  modalidad: ModalidadPedido;
  direccion?: string;
  items: ItemSolicitud[];
}

export interface PedidoAdmin {
  id: string;
  numero: number;
  clienteNombre: string;
  contacto: string;
  modalidad: ModalidadPedido;
  direccion: string | null;
  estado: EstadoPedido;
  items: ItemPedido[];
  total: number;
  creadoEn: string;
}

export interface EntradaHistorial {
  estado: EstadoPedido;
  responsable: string;
  registradoEn: string;
}

export interface PedidoConHistorial extends PedidoAdmin {
  historial: EntradaHistorial[];
}

// Vista del vecino sobre su propio pedido: sin nombres internos ni responsables.
// El historial permite mostrar el estado en línea desde su cuenta (HU-03).
export interface PedidoVecino {
  numero: number;
  estado: EstadoPedido;
  modalidad: ModalidadPedido;
  direccion: string | null;
  items: ItemPedido[];
  total: number;
  creadoEn: string;
  actualizadoEn: string;
  historial: EntradaSeguimiento[];
}

// HU-07: lo que el vecino ve al consultar el estado de su pedido.
export interface EntradaSeguimiento {
  estado: EstadoPedido;
  registradoEn: string;
}

export interface PedidoSeguimiento extends PedidoVecino {
  historial: EntradaSeguimiento[];
}

// Transiciones permitidas según HU-10/HU-11 (flujo lineal + cancelación).
const TRANSICIONES: Record<EstadoPedido, readonly EstadoPedido[]> = {
  RECIBIDO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO_PARA_RETIRO', 'EN_DESPACHO', 'CANCELADO'],
  LISTO_PARA_RETIRO: ['ENTREGADO', 'CANCELADO'],
  EN_DESPACHO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

export function transicionesPermitidas(estado: EstadoPedido): readonly EstadoPedido[] {
  return TRANSICIONES[estado] ?? [];
}

// El retiro pasa por LISTO_PARA_RETIRO y el delivery por EN_DESPACHO.
export function esTransicionValida(
  actual: EstadoPedido,
  siguiente: EstadoPedido,
  modalidad: ModalidadPedido,
): boolean {
  if (siguiente === 'LISTO_PARA_RETIRO' && modalidad !== 'RETIRO') return false;
  if (siguiente === 'EN_DESPACHO' && modalidad !== 'DELIVERY') return false;
  return transicionesPermitidas(actual).includes(siguiente);
}

type FilaPedido = typeof schema.pedidos.$inferSelect;

function aPedido(fila: FilaPedido): PedidoAdmin {
  return {
    id: fila.id,
    numero: fila.numero,
    clienteNombre: fila.clienteNombre,
    contacto: fila.contacto,
    modalidad: fila.modalidad as ModalidadPedido,
    direccion: fila.direccion,
    estado: fila.estado as EstadoPedido,
    items: fila.items,
    total: fila.total,
    creadoEn: fila.creadoEn.toISOString(),
  };
}

// Cola de pedidos (HU-10), más recientes primero, con filtro opcional por estado.
export async function listarPedidos(
  db: Database,
  estado?: EstadoPedido,
): Promise<PedidoAdmin[]> {
  const filas = await db
    .select()
    .from(schema.pedidos)
    .where(estado ? eq(schema.pedidos.estado, estado) : undefined)
    .orderBy(asc(schema.pedidos.creadoEn));
  return filas.map(aPedido);
}

function aPedidoVecino(fila: FilaPedido, historial: EntradaSeguimiento[]): PedidoVecino {
  return {
    numero: fila.numero,
    estado: fila.estado as EstadoPedido,
    modalidad: fila.modalidad as ModalidadPedido,
    direccion: fila.direccion,
    items: fila.items,
    total: fila.total,
    creadoEn: fila.creadoEn.toISOString(),
    actualizadoEn: fila.actualizadoEn.toISOString(),
    historial,
  };
}

function aEntradaSeguimiento(fila: {
  estado: string;
  registradoEn: Date;
}): EntradaSeguimiento {
  return { estado: fila.estado as EstadoPedido, registradoEn: fila.registradoEn.toISOString() };
}

// Pedidos asociados a la cuenta del vecino (HU-03), más recientes primero,
// cada uno con su historial de estados para mostrarlo en línea.
export async function listarPedidosVecino(
  db: Database,
  vecinoId: string,
): Promise<PedidoVecino[]> {
  const filas = await db
    .select()
    .from(schema.pedidos)
    .where(eq(schema.pedidos.vecinoId, vecinoId))
    .orderBy(desc(schema.pedidos.creadoEn));
  if (filas.length === 0) return [];

  const entradas = await db
    .select()
    .from(schema.pedidoHistorial)
    .where(inArray(schema.pedidoHistorial.pedidoId, filas.map((f) => f.id)))
    .orderBy(asc(schema.pedidoHistorial.registradoEn));

  const porPedido = new Map<string, EntradaSeguimiento[]>();
  for (const fila of filas) porPedido.set(fila.id, []);
  for (const entrada of entradas) {
    porPedido.get(entrada.pedidoId)?.push(aEntradaSeguimiento(entrada));
  }

  return filas.map((fila) => aPedidoVecino(fila, porPedido.get(fila.id) ?? []));
}

// Consulta pública de estado (HU-07): número de pedido + contacto del solicitante.
// El contacto actúa de llave para no exponer pedidos a terceros.
export async function seguirPedido(
  db: Database,
  numero: number,
  contacto: string,
): Promise<PedidoSeguimiento> {
  const [fila] = await db
    .select()
    .from(schema.pedidos)
    .where(eq(schema.pedidos.numero, numero))
    .limit(1);

  const coincide =
    fila !== undefined &&
    fila.contacto.trim().toLowerCase() === contacto.trim().toLowerCase();
  if (!coincide) {
    throw new ErrorHttp(404, 'No encontramos un pedido con ese número y contacto.');
  }

  const historial = await db
    .select()
    .from(schema.pedidoHistorial)
    .where(eq(schema.pedidoHistorial.pedidoId, fila.id))
    .orderBy(asc(schema.pedidoHistorial.registradoEn));

  return aPedidoVecino(
    fila,
    historial.map((h) => aEntradaSeguimiento(h)),
  );
}

// Detalle de un pedido con su historial de cambios (responsable/fecha/hora).
export async function obtenerPedido(
  db: Database,
  id: string,
): Promise<PedidoConHistorial> {
  const [fila] = await db
    .select()
    .from(schema.pedidos)
    .where(eq(schema.pedidos.id, id))
    .limit(1);
  if (!fila) throw new ErrorHttp(404, 'Pedido no encontrado.');

  const historial = await db
    .select()
    .from(schema.pedidoHistorial)
    .where(eq(schema.pedidoHistorial.pedidoId, id))
    .orderBy(asc(schema.pedidoHistorial.registradoEn));

  return {
    ...aPedido(fila),
    historial: historial.map((h) => ({
      estado: h.estado as EstadoPedido,
      responsable: h.responsable,
      registradoEn: h.registradoEn.toISOString(),
    })),
  };
}

// Cambio de estado con validación de flujo y registro de quién/qué/cuándo.
export async function cambiarEstadoPedido(
  db: Database,
  id: string,
  siguiente: EstadoPedido,
  responsable: string,
): Promise<PedidoConHistorial> {
  const [actual] = await db
    .select()
    .from(schema.pedidos)
    .where(eq(schema.pedidos.id, id))
    .limit(1);
  if (!actual) throw new ErrorHttp(404, 'Pedido no encontrado.');

  const modalidad = actual.modalidad as ModalidadPedido;
  if (!esTransicionValida(actual.estado as EstadoPedido, siguiente, modalidad)) {
    throw new ErrorHttp(
      409,
      `No se puede pasar de "${actual.estado}" a "${siguiente}" en un pedido de ${
        modalidad === 'DELIVERY' ? 'delivery' : 'retiro'
      }.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.pedidos)
      .set({ estado: siguiente, actualizadoEn: new Date() })
      .where(eq(schema.pedidos.id, id));
    await tx.insert(schema.pedidoHistorial).values({ pedidoId: id, estado: siguiente, responsable });
  });

  return obtenerPedido(db, id);
}


// Checkout mínimo: valida contra la BD, cobra stock y registra el pedido.
// vecinoId es la cuenta del comprador si tenía sesión (HU-03); null si compra como invitado.
export async function crearPedido(
  db: Database,
  solicitud: SolicitudPedido,
  responsable: string,
  vecinoId: string | null,
): Promise<PedidoConHistorial> {
  const items = solicitud.items;
  if (items.length === 0) {
    throw new ErrorHttp(400, 'El pedido debe incluir al menos un medicamento.');
  }
  if (solicitud.modalidad === 'DELIVERY' && !solicitud.direccion?.trim()) {
    throw new ErrorHttp(400, 'El pedido a domicilio requiere una dirección.');
  }

  const codigos = items.map((item) => item.codigo);
  const medicamentos = await db
    .select()
    .from(schema.medicamentos)
    .where(inArray(schema.medicamentos.codigo, codigos));

  const porCodigo = new Map(medicamentos.map((m) => [m.codigo, m]));
  const itemsPedido: ItemPedido[] = [];

  for (const item of items) {
    const med = porCodigo.get(item.codigo);
    if (!med || !med.activo) {
      throw new ErrorHttp(400, `El medicamento ${item.codigo} no está disponible.`);
    }
    if (med.stock < item.cantidad) {
      throw new ErrorHttp(
        409,
        `Stock insuficiente para ${med.principioActivo}: quedan ${med.stock} unidades.`,
      );
    }
    itemsPedido.push({
      codigo: med.codigo,
      nombre: med.principioActivo,
      precio: med.precio,
      cantidad: item.cantidad,
    });
  }

  const total = itemsPedido.reduce((acc, item) => acc + item.precio * item.cantidad, 0);

  // Medicamentos con receta: solo con cuenta propia y receta aceptada que
  // los indique (HU recetas). El invitado nunca puede comprarlos.
  const conReceta = itemsPedido.filter((item) => porCodigo.get(item.codigo)?.requiereReceta);
  if (conReceta.length > 0) {
    if (!vecinoId) {
      throw new ErrorHttp(
        403,
        'Para comprar medicamentos que requieren receta debes iniciar sesión con tu cuenta y adjuntar la receta médica desde Mi cuenta.',
      );
    }
    const motivo = validarCoberturaReceta(conReceta, await recetasAceptadas(db, vecinoId));
    if (motivo) throw new ErrorHttp(403, motivo);
  }

  return db.transaction(async (tx) => {
    const [pedido] = await tx
      .insert(schema.pedidos)
      .values({
        clienteNombre: solicitud.clienteNombre.trim(),
        contacto: solicitud.contacto.trim(),
        modalidad: solicitud.modalidad,
        direccion: solicitud.direccion?.trim() ?? null,
        estado: 'RECIBIDO',
        items: itemsPedido,
        total,
        vecinoId,
      })
      .returning();
    if (!pedido) throw new ErrorHttp(500, 'No se pudo registrar el pedido.');

    // Descuento atómico: solo si sigue habiendo stock suficiente.
    for (const item of itemsPedido) {
      const descontados = await tx
        .update(schema.medicamentos)
        .set({
          stock: sql`${schema.medicamentos.stock} - ${item.cantidad}`,
          actualizadoEn: new Date(),
        })
        .where(
          and(
            eq(schema.medicamentos.codigo, item.codigo),
            gte(schema.medicamentos.stock, item.cantidad),
          ),
        )
        .returning({ id: schema.medicamentos.id });
      if (descontados.length === 0) {
        throw new ErrorHttp(409, `Stock insuficiente para ${item.nombre}.`);
      }
    }

    await tx.insert(schema.pedidoHistorial).values({
      pedidoId: pedido.id,
      estado: 'RECIBIDO',
      responsable,
    });

    const historial = await tx
      .select()
      .from(schema.pedidoHistorial)
      .where(eq(schema.pedidoHistorial.pedidoId, pedido.id))
      .orderBy(asc(schema.pedidoHistorial.registradoEn));

    return {
      ...aPedido(pedido),
      historial: historial.map((h) => ({
        estado: h.estado as EstadoPedido,
        responsable: h.responsable,
        registradoEn: h.registradoEn.toISOString(),
      })),
    };
  });
}
