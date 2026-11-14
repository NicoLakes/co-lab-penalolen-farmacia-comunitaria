import type { Pedido } from './admin.api';

export type OrdenPedidos = 'recientes' | 'antiguos';

// Ordenamiento de la cola de pedidos (por defecto, lo más reciente primero).
// Las fechas son ISO 8601 en UTC: comparar el texto es comparar el tiempo.
export function ordenarPedidos(pedidos: Pedido[], orden: OrdenPedidos): Pedido[] {
  return [...pedidos].sort((a, b) =>
    orden === 'recientes'
      ? b.creadoEn.localeCompare(a.creadoEn)
      : a.creadoEn.localeCompare(b.creadoEn),
  );
}
