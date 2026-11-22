import { useRef, useState } from 'react';
import type { Medicamento } from './medicamentos.mock';

export interface ItemCarrito {
  medicamento: Medicamento;
  cantidad: number;
}

interface ResumenPedidoCreado {
  orderNumber: string;
  totalClp: string;
  fulfillmentMethod: 'pickup' | 'delivery';
}

interface CarritoPanelProps {
  carrito: ItemCarrito[];
  abierto: boolean;
  usuarioEmail?: string | undefined;
  deliveryFeeClp: number | null;
  onCerrar: () => void;
  onCambiarCantidad: (codigo: string, nuevaCantidad: number) => void;
  onPedidoCreado?: () => void;
  onSolicitarInicioSesion?: () => void;
  onVerMisPedidos?: () => void;
}

export function CarritoPanel({
  carrito,
  abierto,
  usuarioEmail,
  deliveryFeeClp,
  onCerrar,
  onCambiarCantidad,
  onPedidoCreado,
  onSolicitarInicioSesion,
  onVerMisPedidos,
}: CarritoPanelProps) {
  const [metodoEntrega, setMetodoEntrega] = useState<'pickup' | 'delivery'>('pickup');
  const [nombreReceptor, setNombreReceptor] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('Peñalolén');
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState('');
  const [requiereInicioSesion, setRequiereInicioSesion] = useState(false);
  const alertaRef = useRef<HTMLDivElement>(null);
  const [pedidoExitoso, setPedidoExitoso] = useState<ResumenPedidoCreado | null>(null);
  const lastSubmission = useRef<{ account: string; request: string; key: string } | null>(null);

  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const subtotalPrecio = carrito.reduce(
    (acc, item) => acc + BigInt(item.medicamento.precio) * BigInt(item.cantidad),
    0n,
  );
  const totalPrecio = subtotalPrecio + BigInt(metodoEntrega === 'delivery' ? deliveryFeeClp ?? 0 : 0);
  const carritoRequiereReceta = carrito.some((item) => item.medicamento.requiereReceta);
  const catalogoDisponible = deliveryFeeClp !== null && carrito.every(({ medicamento }) => medicamento.id);

  async function confirmarSolicitud() {
    if (enviando || carritoRequiereReceta || !catalogoDisponible) return;
    setErrorPedido('');
    setRequiereInicioSesion(false);
    setPedidoExitoso(null);

    if (!usuarioEmail) {
      setRequiereInicioSesion(true);
      requestAnimationFrame(() => alertaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      return;
    }

    if (metodoEntrega === 'delivery' && (!nombreReceptor.trim() || !telefono.trim() || !direccion.trim() || !comuna.trim())) {
      setErrorPedido('Completa todos los datos de despacho a domicilio.');
      return;
    }

    setEnviando(true);
    try {
      const order = {
        items: carrito.map(({ medicamento, cantidad }) => ({ productId: medicamento.id, quantity: cantidad })),
        fulfillment: metodoEntrega === 'pickup'
          ? { method: 'pickup' }
          : {
              method: 'delivery',
              details: {
                recipientName: nombreReceptor.trim(),
                phone: telefono.trim(),
                address: direccion.trim(),
                commune: comuna.trim(),
              },
            },
      };
      const request = JSON.stringify(order);
      if (lastSubmission.current?.request !== request || lastSubmission.current.account !== usuarioEmail) {
        lastSubmission.current = { request, account: usuarioEmail, key: crypto.randomUUID() };
      }
      const respuesta = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...order, idempotencyKey: lastSubmission.current.key }),
      });

      const datos: unknown = await respuesta.json().catch(() => null);
      if (respuesta.status === 401) {
        setRequiereInicioSesion(true);
        requestAnimationFrame(() => alertaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
        return;
      }
      if (respuesta.status === 403) {
        setErrorPedido('Tu cuenta aún no tiene permisos de compra habilitados.');
        return;
      }
      if (!respuesta.ok || !datos || typeof datos !== 'object'
        || !('orderNumber' in datos) || typeof datos.orderNumber !== 'string'
        || !('totalClp' in datos) || typeof datos.totalClp !== 'string' || !/^\d{1,19}$/.test(datos.totalClp)
        || !('fulfillmentMethod' in datos) || (datos.fulfillmentMethod !== 'pickup' && datos.fulfillmentMethod !== 'delivery')) {
        const codigoError = datos && typeof datos === 'object' && 'code' in datos ? String(datos.code) : '';
        setErrorPedido(
          codigoError === 'insufficient_stock'
            ? 'No hay stock suficiente para completar uno de los medicamentos seleccionados.'
            : 'No pudimos registrar la solicitud en la base de datos. Inténtalo de nuevo.',
        );
        return;
      }

      const { orderNumber, totalClp, fulfillmentMethod } = datos;
      setPedidoExitoso({ orderNumber, totalClp, fulfillmentMethod });
      lastSubmission.current = null;
      onPedidoCreado?.();
    } catch {
      setErrorPedido('Error de conexión al registrar tu pedido.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div
        className={abierto ? 'carrito-backdrop abierto' : 'carrito-backdrop'}
        onClick={onCerrar}
        aria-hidden="true"
      />
      <aside
        className={abierto ? 'carrito-panel abierto' : 'carrito-panel'}
        aria-label="Carrito de compras"
        aria-hidden={!abierto}
      >
        <div className="carrito-header">
          <h2>Mi Solicitud de Compra ({totalUnidades} productos)</h2>
          <button type="button" className="btn-cerrar-carrito" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        {pedidoExitoso && (
          <div className="alerta-pedido-exito" role="status">
            <strong>Solicitud registrada</strong>
            <p>
              Número de orden: <strong>{pedidoExitoso.orderNumber}</strong> · Total:{' '}
              <strong>${BigInt(pedidoExitoso.totalClp).toLocaleString('es-CL')}</strong>
            </p>
            <p>
              Stock reservado para {pedidoExitoso.fulfillmentMethod === 'pickup' ? 'retiro en farmacia' : 'despacho a domicilio'}.
            </p>
            {onVerMisPedidos && (
              <button
                type="button"
                className="btn-ver-pedidos-exito"
                onClick={onVerMisPedidos}
              >
                Ver en Mis pedidos
              </button>
            )}
          </div>
        )}

        {carrito.length === 0 ? (
          <p className="carrito-vacio">Aún no has agregado medicamentos a tu carrito.</p>
        ) : (
          <>
            <ul className="carrito-lista">
              {carrito.map(({ medicamento, cantidad }) => (
                <li key={medicamento.codigo} className="carrito-item">
                  <div className="carrito-item-info">
                    <strong>{medicamento.principioActivo}</strong>
                    <span>
                      ${medicamento.precio.toLocaleString('es-CL')} c/u
                      {medicamento.requiereReceta ? ' · Requiere receta' : ' · Venta directa'}
                    </span>
                  </div>

                  <div className="carrito-controles">
                    <button
                      type="button"
                      className="btn-cantidad"
                      disabled={enviando}
                      onClick={() => onCambiarCantidad(medicamento.codigo, cantidad - 1)}
                    >
                      -
                    </button>
                    <span className="cantidad-valor">{cantidad}</span>
                    <button
                      type="button"
                      className="btn-cantidad"
                      disabled={enviando}
                      onClick={() => onCambiarCantidad(medicamento.codigo, cantidad + 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {carritoRequiereReceta && (
              <div className="alerta-receta-isp">
                Los medicamentos con receta requieren revisión de la farmacia. La compra en línea de estos productos aún no está disponible.
              </div>
            )}

            {catalogoDisponible && !carritoRequiereReceta && (
              <div className="carrito-entrega-box">
                <strong>Modalidad de entrega:</strong>
                <div className="entrega-opciones">
                  <button
                    type="button"
                    className={metodoEntrega === 'pickup' ? 'chip activo' : 'chip'}
                    onClick={() => setMetodoEntrega('pickup')}
                  >
                    Retiro en Farmacia ($0)
                  </button>
                  <button
                    type="button"
                    className={metodoEntrega === 'delivery' ? 'chip activo' : 'chip'}
                    onClick={() => setMetodoEntrega('delivery')}
                  >
                    Despacho a domicilio (+${deliveryFeeClp?.toLocaleString('es-CL')})
                  </button>
                </div>

                {metodoEntrega === 'delivery' && (
                  <div className="entrega-campos">
                    <input
                      type="text"
                      className="input-busqueda"
                      placeholder="Nombre de quien recibe"
                      aria-label="Nombre de quien recibe"
                      maxLength={300}
                      value={nombreReceptor}
                      onChange={(e) => setNombreReceptor(e.target.value)}
                    />
                    <input
                      type="tel"
                      className="input-busqueda"
                      placeholder="Teléfono de contacto (ej: +56912345678)"
                      aria-label="Teléfono de contacto"
                      maxLength={300}
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input-busqueda"
                      placeholder="Dirección (Calle y número)"
                      aria-label="Dirección"
                      maxLength={300}
                      value={direccion}
                      onChange={(e) => setDireccion(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input-busqueda"
                      placeholder="Comuna"
                      aria-label="Comuna"
                      maxLength={300}
                      value={comuna}
                      onChange={(e) => setComuna(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {!catalogoDisponible && (
              <p role="status">Las solicitudes de compra en línea no están disponibles.</p>
            )}

            {errorPedido && (
              <div className="carrito-alerta-error" role="alert">
                {errorPedido}
              </div>
            )}

            <div className="carrito-resumen">
              {requiereInicioSesion && (
                <div ref={alertaRef} className="carrito-alerta-auth" role="alert">
                  <strong>Inicia sesión antes de confirmar tu solicitud</strong>
                  <p>Necesitas autenticarte con tu correo para reservar stock y registrar el pedido.</p>
                  {onSolicitarInicioSesion && (
                    <button
                      type="button"
                      className="btn-ir-login"
                      onClick={() => {
                        setRequiereInicioSesion(false);
                        onSolicitarInicioSesion();
                      }}
                    >
                      Iniciar sesión ahora
                    </button>
                  )}
                </div>
              )}
              <div className="carrito-total-fila">
                <span>Total estimado:</span>
                <strong>${totalPrecio.toLocaleString('es-CL')}</strong>
              </div>
              <button
                type="button"
                className="btn-continuar-checkout"
                disabled={enviando || carritoRequiereReceta || !catalogoDisponible}
                onClick={() => void confirmarSolicitud()}
              >
                {enviando ? 'Registrando Solicitud…' : 'Confirmar Solicitud de Compra'}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
