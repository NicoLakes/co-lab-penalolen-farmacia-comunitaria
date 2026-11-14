// Contratos y clientes HTTP del panel de funcionarios/administración.
import type { Medicamento } from '../catalogo/medicamentos.api';

export type Rol = 'admin' | 'funcionario';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface MedicamentoAdmin extends Medicamento {
  id: string;
  activo: boolean;
}

export type EstadoPedido =
  | 'RECIBIDO'
  | 'EN_PREPARACION'
  | 'LISTO_PARA_RETIRO'
  | 'EN_DESPACHO'
  | 'ENTREGADO'
  | 'CANCELADO';

export type ModalidadPedido = 'RETIRO' | 'DELIVERY';

export interface ItemPedido {
  codigo: string;
  nombre: string;
  precio: number;
  cantidad: number;
}

export interface EntradaHistorial {
  estado: EstadoPedido;
  responsable: string;
  registradoEn: string;
}

export interface Pedido {
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
  historial?: EntradaHistorial[];
}

export const ESTADOS_PEDIDO: EstadoPedido[] = [
  'RECIBIDO',
  'EN_PREPARACION',
  'LISTO_PARA_RETIRO',
  'EN_DESPACHO',
  'ENTREGADO',
  'CANCELADO',
];

export const ETIQUETAS_ESTADO: Record<EstadoPedido, string> = {
  RECIBIDO: 'Recibido',
  EN_PREPARACION: 'En preparación',
  LISTO_PARA_RETIRO: 'Listo para retiro',
  EN_DESPACHO: 'En despacho',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
};

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    signal: AbortSignal.timeout(10000),
  });

  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const mensaje =
      typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo
        ? String((cuerpo as { error: unknown }).error)
        : `Error ${respuesta.status}`;
    throw new Error(mensaje);
  }
  return cuerpo as T;
}

function json(metodo: string, datos: unknown): RequestInit {
  return {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(datos),
  };
}

// --- Sesión ---
export async function iniciarSesion(email: string, password: string): Promise<Usuario> {
  const cuerpo = await pedir<{ usuario: Usuario }>('/api/auth/login', json('POST', { email, password }));
  return cuerpo.usuario;
}

export async function cerrarSesion(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

export async function usuarioActual(): Promise<Usuario> {
  const cuerpo = await pedir<Usuario>('/api/auth/me');
  return cuerpo;
}

// --- Medicamentos ---
export async function listarMedicamentosAdmin(): Promise<MedicamentoAdmin[]> {
  const cuerpo = await pedir<{ medicamentos: MedicamentoAdmin[] }>('/api/admin/medicamentos');
  return cuerpo.medicamentos;
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

export async function crearMedicamento(datos: DatosMedicamento): Promise<MedicamentoAdmin> {
  const cuerpo = await pedir<{ medicamento: MedicamentoAdmin }>(
    '/api/admin/medicamentos',
    json('POST', datos),
  );
  return cuerpo.medicamento;
}

export async function actualizarMedicamento(
  id: string,
  cambios: Partial<Pick<DatosMedicamento, 'precio' | 'stock' | 'requiereReceta'>>,
): Promise<MedicamentoAdmin> {
  const cuerpo = await pedir<{ medicamento: MedicamentoAdmin }>(
    `/api/admin/medicamentos/${encodeURIComponent(id)}`,
    json('PATCH', cambios),
  );
  return cuerpo.medicamento;
}

export async function darDeBaja(id: string): Promise<MedicamentoAdmin> {
  const cuerpo = await pedir<{ medicamento: MedicamentoAdmin }>(
    `/api/admin/medicamentos/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return cuerpo.medicamento;
}

// Borrado definitivo: la API exige que el medicamento ya esté dado de baja.
export async function eliminarMedicamento(id: string): Promise<void> {
  await pedir<null>(
    `/api/admin/medicamentos/${encodeURIComponent(id)}/definitivo`,
    { method: 'DELETE' },
  );
}

export async function reactivarMedicamento(id: string): Promise<MedicamentoAdmin> {
  const cuerpo = await pedir<{ medicamento: MedicamentoAdmin }>(
    `/api/admin/medicamentos/${encodeURIComponent(id)}/reactivar`,
    { method: 'POST' },
  );
  return cuerpo.medicamento;
}

// --- Pedidos ---
export async function listarPedidos(estado?: EstadoPedido): Promise<Pedido[]> {
  const query = estado ? `?estado=${encodeURIComponent(estado)}` : '';
  const cuerpo = await pedir<{ pedidos: Pedido[] }>(`/api/admin/pedidos${query}`);
  return cuerpo.pedidos;
}

export async function obtenerPedido(id: string): Promise<Pedido> {
  const cuerpo = await pedir<{ pedido: Pedido }>(
    `/api/admin/pedidos/${encodeURIComponent(id)}`,
  );
  return cuerpo.pedido;
}

export async function cambiarEstadoPedido(id: string, estado: EstadoPedido): Promise<Pedido> {
  const cuerpo = await pedir<{ pedido: Pedido }>(
    `/api/admin/pedidos/${encodeURIComponent(id)}/estado`,
    json('PATCH', { estado }),
  );
  return cuerpo.pedido;
}
