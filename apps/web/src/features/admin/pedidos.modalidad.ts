import type { EstadoPedido, ModalidadPedido } from './admin.api';

// Estados que el panel ofrece como siguiente paso (la API valida el flujo real).
const SIGUIENTES: Record<EstadoPedido, EstadoPedido[]> = {
  RECIBIDO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO_PARA_RETIRO', 'EN_DESPACHO', 'CANCELADO'],
  LISTO_PARA_RETIRO: ['ENTREGADO', 'CANCELADO'],
  EN_DESPACHO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

// Retiro y delivery tienen flujos distintos: solo delivery pasa por despacho.
export function siguientesSegunModalidad(
  estado: EstadoPedido,
  modalidad: ModalidadPedido,
): EstadoPedido[] {
  return SIGUIENTES[estado].filter((siguiente) =>
    modalidad === 'DELIVERY' ? siguiente !== 'LISTO_PARA_RETIRO' : siguiente !== 'EN_DESPACHO',
  );
}
