// Cliente HTTP de la cuenta del vecino (HU-03): datos, sesión, pedidos y recetas.
import type { EstadoPedido, ItemPedido, ModalidadPedido } from '../admin/admin.api';
import type { EntradaSeguimiento } from '../seguimiento/seguimiento.api';

export interface Vecino {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  direccion: string | null;
}

export type EstadoReceta = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';

export interface ItemReceta {
  codigo: string;
  nombre: string;
  cantidad: number;
}

export interface Receta {
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

export const ETIQUETAS_RECETA: Record<EstadoReceta, string> = {
  PENDIENTE: 'En revisión',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
};

export const TIPOS_ARCHIVO_RECETA = ['application/pdf', 'image/jpeg', 'image/png'];
export const TAMANO_MAXIMO_RECETA = 4 * 1024 * 1024;

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

export async function registrarVecino(
  nombre: string,
  email: string,
  telefono: string,
  direccion: string,
  password: string,
): Promise<Vecino> {
  const cuerpo = await pedir<{ vecino: Vecino }>(
    '/api/vecinos/registro',
    json('POST', { nombre, email, telefono, direccion, password }),
  );
  return cuerpo.vecino;
}

// Edición de los datos de la cuenta desde "Mi cuenta".
export async function actualizarVecino(cambios: {
  nombre?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}): Promise<Vecino> {
  const cuerpo = await pedir<{ vecino: Vecino }>('/api/vecinos/me', json('PATCH', cambios));
  return cuerpo.vecino;
}

export async function iniciarSesionVecino(email: string, password: string): Promise<Vecino> {
  const cuerpo = await pedir<{ vecino: Vecino }>(
    '/api/vecinos/login',
    json('POST', { email, password }),
  );
  return cuerpo.vecino;
}

export async function cerrarSesionVecino(): Promise<void> {
  await fetch('/api/vecinos/logout', { method: 'POST', credentials: 'same-origin' });
}

// Lanza 401 (como Error) cuando no hay sesión vigente.
export async function vecinoActual(): Promise<Vecino> {
  return pedir<Vecino>('/api/vecinos/me');
}

export async function pedidosDelVecino(): Promise<PedidoVecino[]> {
  const cuerpo = await pedir<{ pedidos: PedidoVecino[] }>('/api/vecinos/pedidos');
  return cuerpo.pedidos;
}

async function archivoABase64(archivo: File): Promise<string> {
  const buffer = await archivo.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binario = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

// Receta médica adjuntada por el vecino: queda pendiente de revisión.
export async function subirReceta(archivo: File): Promise<Receta> {
  if (!TIPOS_ARCHIVO_RECETA.includes(archivo.type)) {
    throw new Error('La receta debe ser un PDF, JPG o PNG.');
  }
  if (archivo.size > TAMANO_MAXIMO_RECETA) {
    throw new Error('La receta supera el máximo de 4 MB.');
  }

  const respuesta = await fetch('/api/vecinos/recetas', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nombre: archivo.name.slice(0, 120),
      tipo: archivo.type,
      datos: await archivoABase64(archivo),
    }),
    signal: AbortSignal.timeout(30000),
  });

  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const mensaje =
      typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo
        ? String((cuerpo as { error: unknown }).error)
        : `Error ${respuesta.status}`;
    throw new Error(mensaje);
  }
  return (cuerpo as { receta: Receta }).receta;
}

export async function recetasDelVecino(): Promise<Receta[]> {
  const cuerpo = await pedir<{ recetas: Receta[] }>('/api/vecinos/recetas');
  return cuerpo.recetas;
}
