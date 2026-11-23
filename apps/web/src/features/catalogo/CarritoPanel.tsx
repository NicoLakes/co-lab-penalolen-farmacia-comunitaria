import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ALLOWED_PRESCRIPTION_MIME_TYPES,
  createPrescriptionOrder,
  fileToBase64,
  MAX_PRESCRIPTION_BYTES,
  OrdersApiError,
  payMyOrder,
} from '../orders/orders.api';
import type { AllowedPrescriptionMimeType } from '../orders/orders.api';
import type { Medicamento } from './medicamentos.mock';

export interface ItemCarrito {
  medicamento: Medicamento;
  cantidad: number;
}

interface ResumenPedidoCreado {
  id: string;
  orderNumber: string;
  status: 'pending_review' | 'pending_payment';
  totalClp: string;
  fulfillmentMethod: 'pickup' | 'delivery';
}

interface SelectedPrescriptionFile {
  file: File;
  mimeType: AllowedPrescriptionMimeType;
}

interface CarritoPanelProps {
  carrito: ItemCarrito[];
  abierto: boolean;
  usuarioEmail?: string | undefined;
  deliveryFeeClp: number | null;
  onCerrar: () => void;
  onCambiarCantidad: (codigo: string, nuevaCantidad: number) => void;
  onPedidoCreado?: (() => void) | undefined;
  onStockAgotado?: (() => void) | undefined;
  onSolicitarInicioSesion?: (() => void) | undefined;
  onVerMisPedidos?: (() => void) | undefined;
}

function resolvePrescriptionMimeType(file: File): AllowedPrescriptionMimeType | null {
  const declared = file.type.trim().toLowerCase();
  if (declared === 'image/jpg') return 'image/jpeg';
  const exact = ALLOWED_PRESCRIPTION_MIME_TYPES.find((candidate) => candidate === declared);
  if (exact) return exact;

  const lowerName = file.name.trim().toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CarritoPanel({
  carrito,
  abierto,
  usuarioEmail,
  deliveryFeeClp,
  onCerrar,
  onCambiarCantidad,
  onPedidoCreado,
  onStockAgotado,
  onSolicitarInicioSesion,
  onVerMisPedidos,
}: CarritoPanelProps) {
  const [metodoEntrega, setMetodoEntrega] = useState<'pickup' | 'delivery'>('pickup');
  const [nombreReceptor, setNombreReceptor] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('Peñalolén');
  const [archivoReceta, setArchivoReceta] = useState<SelectedPrescriptionFile | null>(null);
  const [errorRecetaArchivo, setErrorRecetaArchivo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState('');
  const [requiereInicioSesion, setRequiereInicioSesion] = useState(false);
  const alertaRef = useRef<HTMLDivElement>(null);
  const [pedidoExitoso, setPedidoExitoso] = useState<ResumenPedidoCreado | null>(null);
  const [pagandoExito, setPagandoExito] = useState(false);
  const [pedidoPagado, setPedidoPagado] = useState(false);
  const [errorPagoExito, setErrorPagoExito] = useState('');
  const payKeyRef = useRef<string | null>(null);
  const lastSubmission = useRef<{ account: string; request: string; key: string } | null>(null);

  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const subtotalPrecio = carrito.reduce(
    (acc, item) => acc + BigInt(item.medicamento.precio) * BigInt(item.cantidad),
    0n,
  );
  const totalPrecio = subtotalPrecio + BigInt(metodoEntrega === 'delivery' ? deliveryFeeClp ?? 0 : 0);
  const carritoTieneRecetaCheque = carrito.some((item) => item.medicamento.condicionVenta === 'prescription_cheque');
  const carritoRequiereReceta = carrito.some((item) => item.medicamento.requiereReceta);
  const faltaAdjuntarReceta = carritoRequiereReceta && !carritoTieneRecetaCheque && !archivoReceta;
  const catalogoDisponible = deliveryFeeClp !== null && carrito.every(({ medicamento }) => medicamento.id);

  function handleSelectPrescriptionFile(event: ChangeEvent<HTMLInputElement>) {
    setErrorRecetaArchivo('');
    setErrorPedido('');
    const file = event.target.files?.[0];
    if (!file) {
      setArchivoReceta(null);
      return;
    }
    if (file.size <= 0) {
      setArchivoReceta(null);
      setErrorRecetaArchivo('El archivo seleccionado está vacío.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PRESCRIPTION_BYTES) {
      setArchivoReceta(null);
      setErrorRecetaArchivo('El archivo supera el límite máximo de 5 MB.');
      event.target.value = '';
      return;
    }
    const mimeType = resolvePrescriptionMimeType(file);
    if (!mimeType) {
      setArchivoReceta(null);
      setErrorRecetaArchivo('Formato no compatible. Adjunta un PDF o imagen JPG, PNG o WEBP.');
      event.target.value = '';
      return;
    }
    setArchivoReceta({ file, mimeType });
  }

  function clearPrescriptionFile() {
    setArchivoReceta(null);
    setErrorRecetaArchivo('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function confirmarSolicitud() {
    if (enviando || carritoTieneRecetaCheque || faltaAdjuntarReceta || !catalogoDisponible) return;
    setErrorPedido('');
    setRequiereInicioSesion(false);
    setPedidoExitoso(null);
    setPedidoPagado(false);
    setErrorPagoExito('');
    payKeyRef.current = null;

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
      const items = carrito.map(({ medicamento, cantidad }) => ({
        productId: medicamento.id as string,
        quantity: cantidad,
      }));
      const fulfillment = metodoEntrega === 'pickup'
        ? { method: 'pickup' as const }
        : {
            method: 'delivery' as const,
            details: {
              recipientName: nombreReceptor.trim(),
              phone: telefono.trim(),
              address: direccion.trim(),
              commune: comuna.trim(),
            },
          };

      if (carritoRequiereReceta && archivoReceta) {
        const requestSignature = JSON.stringify({
          mode: 'prescription',
          items,
          fulfillment,
          file: {
            name: archivoReceta.file.name,
            size: archivoReceta.file.size,
            lastModified: archivoReceta.file.lastModified,
          },
        });
        if (lastSubmission.current?.request !== requestSignature || lastSubmission.current.account !== usuarioEmail) {
          lastSubmission.current = { request: requestSignature, account: usuarioEmail, key: crypto.randomUUID() };
        }
        const contentBase64 = await fileToBase64(archivoReceta.file);
        const created = await createPrescriptionOrder({
          idempotencyKey: lastSubmission.current.key,
          items,
          fulfillment,
          prescription: {
            fileName: archivoReceta.file.name,
            mimeType: archivoReceta.mimeType,
            contentBase64,
          },
        });
        setPedidoExitoso({
          id: created.id,
          orderNumber: created.orderNumber,
          status: 'pending_review',
          totalClp: created.totalClp,
          fulfillmentMethod: created.fulfillmentMethod,
        });
        lastSubmission.current = null;
        clearPrescriptionFile();
        onPedidoCreado?.();
        return;
      }

      const order = { items, fulfillment };
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
        || !('id' in datos) || typeof datos.id !== 'string'
        || !('orderNumber' in datos) || typeof datos.orderNumber !== 'string'
        || !('totalClp' in datos) || typeof datos.totalClp !== 'string' || !/^\d{1,19}$/.test(datos.totalClp)
        || !('fulfillmentMethod' in datos) || (datos.fulfillmentMethod !== 'pickup' && datos.fulfillmentMethod !== 'delivery')) {
        const codigoError = datos && typeof datos === 'object' && 'code' in datos ? String(datos.code) : '';
        const nombresSinStock =
          datos && typeof datos === 'object' && 'productNames' in datos && Array.isArray(datos.productNames)
            ? datos.productNames.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];
        if (codigoError === 'insufficient_stock') {
          setErrorPedido(
            nombresSinStock.length > 0
              ? `No pudimos confirmar tu solicitud porque se agotó o redujo el stock de: ${nombresSinStock.join(', ')}. Actualizamos el catálogo para que ajustes las cantidades.`
              : 'No hay stock suficiente para completar uno de los medicamentos seleccionados. Actualizamos el catálogo para que revises las cantidades.',
          );
          onStockAgotado?.();
          return;
        }
        setErrorPedido(
          codigoError === 'unavailable_product'
            ? 'Uno de los medicamentos ya no está disponible para compra en línea.'
            : 'No pudimos registrar la solicitud en la base de datos. Inténtalo de nuevo.',
        );
        return;
      }

      const { id, orderNumber, totalClp, fulfillmentMethod } = datos;
      setPedidoExitoso({ id, orderNumber, status: 'pending_payment', totalClp, fulfillmentMethod });
      lastSubmission.current = null;
      onPedidoCreado?.();
    } catch (failure: unknown) {
      if (failure instanceof OrdersApiError) {
        if (failure.status === 401) {
          setRequiereInicioSesion(true);
          requestAnimationFrame(() => alertaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
          return;
        }
        setErrorPedido(failure.message);
        if (failure.code === 'insufficient_stock') {
          onStockAgotado?.();
        }
      } else {
        setErrorPedido('Error de conexión al registrar tu pedido.');
      }
    } finally {
      setEnviando(false);
    }
  }

  async function pagarPedidoReciente() {
    if (!pedidoExitoso || pedidoExitoso.status !== 'pending_payment' || pagandoExito || pedidoPagado) return;
    setPagandoExito(true);
    setErrorPagoExito('');
    if (!payKeyRef.current) payKeyRef.current = crypto.randomUUID();
    try {
      await payMyOrder(pedidoExitoso.id, payKeyRef.current);
      setPedidoPagado(true);
      payKeyRef.current = null;
    } catch (failure: unknown) {
      setErrorPagoExito(
        failure instanceof OrdersApiError
          ? failure.message
          : 'No pudimos confirmar el pago. Inténtalo desde Mis pedidos.',
      );
    } finally {
      setPagandoExito(false);
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
            <strong>
              {pedidoExitoso.status === 'pending_review'
                ? 'Solicitud enviada a revisión de receta'
                : pedidoPagado
                  ? 'Pago confirmado'
                  : 'Solicitud registrada'}
            </strong>
            <p>
              Número de orden: <strong>{pedidoExitoso.orderNumber}</strong> · Total:{' '}
              <strong>${BigInt(pedidoExitoso.totalClp).toLocaleString('es-CL')}</strong>
            </p>
            <p>
              {pedidoExitoso.status === 'pending_review'
                ? 'Tu stock ya quedó reservado mientras la farmacia revisa tu receta. Te avisaremos por correo cuando sea aprobada para que puedas pagar.'
                : pedidoPagado
                  ? 'Tu pedido ya pasó a la farmacia para preparación y entrega.'
                  : `Stock reservado por 15 minutos para ${pedidoExitoso.fulfillmentMethod === 'pickup' ? 'retiro en farmacia' : 'despacho a domicilio'}.`}
            </p>
            {errorPagoExito && (
              <p className="carrito-alerta-error" role="alert">{errorPagoExito}</p>
            )}
            <div className="alerta-exito-actions">
              {pedidoExitoso.status === 'pending_payment' && !pedidoPagado && (
                <button
                  type="button"
                  className="btn-agregar"
                  disabled={pagandoExito}
                  onClick={() => void pagarPedidoReciente()}
                >
                  {pagandoExito ? 'Procesando pago…' : 'Pagar ahora'}
                </button>
              )}
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
                      {medicamento.condicionVenta === 'prescription_cheque'
                        ? ' · Receta cheque (solo presencial)'
                        : medicamento.requiereReceta
                          ? ' · Requiere receta'
                          : ' · Venta directa'}
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
                      disabled={enviando || cantidad >= medicamento.stock}
                      onClick={() => onCambiarCantidad(medicamento.codigo, cantidad + 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {carritoTieneRecetaCheque && (
              <div className="alerta-receta-isp" role="alert">
                Este carrito incluye un medicamento con <strong>receta cheque</strong>, que por normativa sanitaria (DS 466) solo puede adquirirse de forma presencial en la farmacia. Quítalo del carrito para continuar.
              </div>
            )}

            {catalogoDisponible && carritoRequiereReceta && !carritoTieneRecetaCheque && (
              <div className="carrito-receta-box">
                <strong>Adjuntar receta médica (obligatorio)</strong>
                <p className="carrito-receta-ayuda">
                  Sube tu receta en <strong>PDF, JPG, PNG o WEBP</strong> (máx. 5 MB). Se adjunta una receta por pedido; si tienes más de un medicamento con receta, puedes subir una foto donde aparezcan o un PDF con todas las hojas.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="carrito-receta-input"
                  aria-label="Adjuntar archivo de receta médica"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  disabled={enviando}
                  onChange={handleSelectPrescriptionFile}
                />
                {archivoReceta && (
                  <div className="receta-file-pill">
                    <div className="receta-file-meta">
                      <strong>{archivoReceta.file.name}</strong>
                      <span className="receta-file-size">{formatFileSize(archivoReceta.file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-peligro-suave"
                      disabled={enviando}
                      onClick={clearPrescriptionFile}
                    >
                      Quitar archivo
                    </button>
                  </div>
                )}
                {errorRecetaArchivo && (
                  <p className="carrito-alerta-error" role="alert">{errorRecetaArchivo}</p>
                )}
              </div>
            )}

            {catalogoDisponible && !carritoTieneRecetaCheque && (
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
                disabled={enviando || carritoTieneRecetaCheque || faltaAdjuntarReceta || !catalogoDisponible}
                onClick={() => void confirmarSolicitud()}
              >
                {enviando
                  ? 'Registrando solicitud…'
                  : carritoRequiereReceta
                    ? faltaAdjuntarReceta
                      ? 'Adjunta tu receta para confirmar'
                      : 'Enviar solicitud a revisión'
                    : 'Confirmar Solicitud de Compra'}
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
