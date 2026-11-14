// Contratos y clientes HTTP para la revisión de recetas del panel.
import type { EstadoReceta, Receta } from '../cuenta/cuenta.api';

export interface RecetaAdmin extends Receta {
  vecino: { id: string; nombre: string; email: string };
}

export type FiltroReceta = EstadoReceta | 'TODAS';

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

export async function listarRecetasAdmin(estado?: EstadoReceta): Promise<RecetaAdmin[]> {
  const query = estado ? `?estado=${encodeURIComponent(estado)}` : '';
  const cuerpo = await pedir<{ recetas: RecetaAdmin[] }>(`/api/admin/recetas${query}`);
  return cuerpo.recetas;
}

// Enlace al archivo original de la receta para verlo en otra pestaña.
export function urlArchivoReceta(id: string): string {
  return `/api/admin/recetas/${encodeURIComponent(id)}/archivo`;
}

export interface EvaluacionReceta {
  estado: 'ACEPTADA' | 'RECHAZADA';
  observaciones?: string;
  items?: { codigo: string; cantidad?: number }[];
}

export async function evaluarReceta(id: string, evaluacion: EvaluacionReceta): Promise<Receta> {
  const cuerpo = await pedir<{ receta: Receta }>(
    `/api/admin/recetas/${encodeURIComponent(id)}/estado`,
    json('POST', evaluacion),
  );
  return cuerpo.receta;
}
