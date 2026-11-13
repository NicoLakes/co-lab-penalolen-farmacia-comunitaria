import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Medicamento } from './medicamentos.mock';
import { analizarRecetaMedica } from './validadorRecetas';
import type { ResultadoValidacionReceta } from './validadorRecetas';

export interface ItemCarrito {
  medicamento: Medicamento;
  cantidad: number;
}

interface ResumenPedidoCreado {
  orderNumber: string;
  totalClp: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  status: string;
}

interface CarritoPanelProps {
  carrito: ItemCarrito[];
  abierto: boolean;
  usuarioEmail?: string | undefined;
  onCerrar: () => void;
  onCambiarCantidad: (codigo: string, nuevaCantidad: number) => void;
  onPedidoCreado?: () => void;
}

const COSTO_DESPACHO_CLP = 1500;

export function CarritoPanel({
  carrito,
  abierto,
  usuarioEmail,
  onCerrar,
  onCambiarCantidad,
  onPedidoCreado,
}: CarritoPanelProps) {
  const [metodoEntrega, setMetodoEntrega] = useState<'pickup' | 'delivery'>('pickup');
  const [nombreReceptor, setNombreReceptor] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('Peñalolén');
  const [resultadoReceta, setResultadoReceta] = useState<ResultadoValidacionReceta | null>(null);
  const [nombreArchivoReceta, setNombreArchivoReceta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState('');
  const [pedidoExitoso, setPedidoExitoso] = useState<ResumenPedidoCreado | null>(null);

  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const subtotalPrecio = carrito.reduce(
    (acc, item) => acc + item.medicamento.precio * item.cantidad,
    0,
  );
  const totalPrecio = subtotalPrecio + (metodoEntrega === 'delivery' ? COSTO_DESPACHO_CLP : 0);
  const medicamentosConReceta = carrito
    .filter((item) => item.medicamento.requiereReceta)
    .map((item) => item.medicamento);
  const carritoRequiereReceta = medicamentosConReceta.length > 0;

  async function manejarSubidaReceta(evento: ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setNombreArchivoReceta(archivo.name);
    setErrorPedido('');
    const resultado = await analizarRecetaMedica(archivo, medicamentosConReceta);
    setResultadoReceta(resultado);
  }

  async function confirmarSolicitud() {
    setErrorPedido('');
    setPedidoExitoso(null);

    if (!usuarioEmail) {
      setErrorPedido('Para confirmar tu solicitud y reservar stock, primero inicia sesión en el botón "Iniciar sesión" arriba a la derecha.');
      return;
    }

    if (carritoRequiereReceta && !resultadoReceta) {
      setErrorPedido('Debes adjuntar tu receta médica antes de enviar la solicitud.');
      return;
    }

    if (metodoEntrega === 'delivery' && (!nombreReceptor.trim() || !telefono.trim() || !direccion.trim() || !comuna.trim())) {
      setErrorPedido('Completa todos los datos de despacho a domicilio.');
      return;
    }

    const itemsConId = carrito.map((item) => ({
      productId: item.medicamento.id ?? '',
      quantity: item.cantidad,
    }));

    if (itemsConId.some((item) => !item.productId)) {
      setErrorPedido('Sincronizando catálogo con la base de datos. Intenta nuevamente en unos segundos.');
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          prescriptionValidated: carritoRequiereReceta ? Boolean(resultadoReceta) : false,
          items: itemsConId,
          fulfillment: metodoEntrega === 'pickup'
            ? { method: 'pickup' }
            : {
                method: 'delivery',
                details: {
                  recipientName: nombreReceptor.trim(),
                  phone: telefono.trim(),
                  address: direccion.trim(),
                  commune: communeTrim(comuna),
                },
              },
        }),
      });

      const datos: unknown = await respuesta.json().catch(() => null);
      if (respuesta.status === 401) {
        setErrorPedido('Tu sesión expiró o no has iniciado sesión. Usa el botón "Iniciar sesión" arriba a la derecha.');
        return;
      }
      if (respuesta.status === 403) {
        setErrorPedido('Tu cuenta aún no tiene permisos de compra habilitados.');
        return;
      }
      if (!respuesta.ok || !datos || typeof datos !== 'object' || !('orderNumber' in datos)) {
        const codigoError = datos && typeof datos === 'object' && 'code' in datos ? String(datos.code) : '';
        setErrorPedido(
          codigoError === 'insufficient_stock'
            ? 'No hay stock suficiente para completar uno de los medicamentos seleccionados.'
            : 'No pudimos registrar la solicitud en la base de datos. Inténtalo de nuevo.',
        );
        return;
      }

      const resumen = datos as ResumenPedidoCreado;
      setPedidoExitoso(resumen);
      setResultadoReceta(null);
      setNombreArchivoReceta('');
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
            <strong>¡Solicitud registrada en Base de Datos!</strong>
            <p>
              Número de orden: <strong>{pedidoExitoso.orderNumber}</strong> · Total:{' '}
              <strong>${Number(pedidoExitoso.totalClp).toLocaleString('es-CL')}</strong>
            </p>
            <p>
              Tu stock ya quedó reservado en PostgreSQL ({pedidoExitoso.fulfillmentMethod === 'pickup' ? 'Retiro en Farmacia' : 'Despacho a Domicilio'}).
            </p>
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
                      onClick={() => onCambiarCantidad(medicamento.codigo, cantidad - 1)}
                    >
                      -
                    </button>
                    <span className="cantidad-valor">{cantidad}</span>
                    <button
                      type="button"
                      className="btn-cantidad"
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
                <strong>Aviso Normativa ISP:</strong> Tu carrito incluye medicamentos sujetos a
                control. Adjunta tu receta médica para continuar:
                <div className="subida-receta-box">
                  <label htmlFor="input-receta-archivo" className="btn-subir-receta">
                    {nombreArchivoReceta ? `Archivo: ${nombreArchivoReceta}` : 'Adjuntar Receta (PDF o Foto)'}
                  </label>
                  <input
                    id="input-receta-archivo"
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(e) => void manejarSubidaReceta(e)}
                    className="input-file-oculto"
                  />
                </div>
                {resultadoReceta && (
                  <p className={resultadoReceta.estado === 'APROBADA_DIGITAL' ? 'receta-ok' : 'receta-revision'}>
                    {resultadoReceta.mensaje}
                  </p>
                )}
              </div>
            )}

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
                  Despacho a Domicilio (+${COSTO_DESPACHO_CLP.toLocaleString('es-CL')})
                </button>
              </div>

              {metodoEntrega === 'delivery' && (
                <div className="entrega-campos">
                  <input
                    type="text"
                    className="input-busqueda"
                    placeholder="Nombre de quien recibe"
                    value={nombreReceptor}
                    onChange={(e) => setNombreReceptor(e.target.value)}
                  />
                  <input
                    type="tel"
                    className="input-busqueda"
                    placeholder="Teléfono de contacto (ej: +56912345678)"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-busqueda"
                    placeholder="Dirección (Calle y número)"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                  />
                  <input
                    type="text"
                    className="input-busqueda"
                    placeholder="Comuna"
                    value={comuna}
                    onChange={(e) => setComuna(e.target.value)}
                  />
                </div>
              )}
            </div>

            {errorPedido && (
              <p className="account-access-error" role="alert">
                {errorPedido}
              </p>
            )}

            <div className="carrito-resumen">
              <div className="carrito-total-fila">
                <span>Total estimado:</span>
                <strong>${totalPrecio.toLocaleString('es-CL')}</strong>
              </div>
              <button
                type="button"
                className="btn-continuar-checkout"
                disabled={enviando}
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

function communeTrim(value: string): string {
  return value.trim() || 'Peñalolén';
}
