// Cliente HTTP de la consulta pública de estado de pedido (HU-07).
import type { EstadoPedido, ItemPedido, ModalidadPedido } from '../admin/admin.api';

export interface EntradaSeguimiento {
  estado: EstadoPedido;
  registradoEn: string;
}

export interface PedidoSeguimiento {
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

// El vecino consulta con su número de pedido y el contacto con el que lo hizo.
export async function consultarPedido(
  numero: number,
  contacto: string,
): Promise<PedidoSeguimiento> {
  const query = new URLSearchParams({ numero: String(numero), contacto });
  const respuesta = await fetch(`/api/pedidos/seguimiento?${query.toString()}`, {
    credentials: 'same-origin',
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

  const pedido =
    typeof cuerpo === 'object' && cuerpo !== null && 'pedido' in cuerpo
      ? (cuerpo as { pedido: PedidoSeguimiento }).pedido
      : null;
  if (!pedido) throw new Error('La respuesta del servidor no es válida.');
  return pedido;
}
