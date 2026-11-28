import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelMyOrder,
  getMyOrderDetail,
  listMyOrders,
  myPrescriptionDownloadUrl,
  OrdersApiError,
  payMyOrder,
} from './orders.api';
import type { FulfillmentMethod, OrderDetail, OrderStatus, OrderSummary, PrescriptionReviewStatus } from './orders.api';

interface OrdersSectionProps {
  modoSimple: boolean;
  demoPayments: boolean;
  onBackToCatalog: () => void;
  onOrderCancelled?: () => void;
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_review: 'En revisión de receta',
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmado',
  fulfilled: 'Entregado',
  cancelled: 'Cancelado',
  expired: 'Reserva vencida',
  rejected: 'Receta rechazada',
};

function statusLabel(status: OrderStatus, method: FulfillmentMethod) {
  return status === 'fulfilled' && method === 'delivery' ? 'Despachado' : STATUS_LABELS[status];
}

const PRESCRIPTION_STATUS_LABELS: Record<PrescriptionReviewStatus, string> = {
  pending: 'Pendiente de revisión farmacéutica',
  approved: 'Aprobada por la farmacia',
  rejected: 'Rechazada por la farmacia',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatClp(amount: string | number | bigint): string {
  const numeric = typeof amount === 'string' ? BigInt(amount) : amount;
  return `$${numeric.toLocaleString('es-CL')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function OrdersSection({
  modoSimple,
  demoPayments,
  onBackToCatalog,
  onOrderCancelled,
}: OrdersSectionProps) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, OrderDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const cancelOperationKeys = useRef<Map<string, string>>(new Map());
  const payOperationKeys = useRef<Map<string, string>>(new Map());

  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await listMyOrders(signal);
      if (signal?.aborted) return;
      setOrders(result);
    } catch (failure: unknown) {
      if (signal?.aborted) return;
      setError(
        failure instanceof OrdersApiError
          ? failure.message
          : 'No pudimos cargar tus pedidos. Revisa tu conexión e inténtalo de nuevo.',
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOrders(controller.signal);
    return () => controller.abort();
  }, [loadOrders]);

  function toggleDetail(orderId: string) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }
    setExpandedOrderId(orderId);
    void loadDetail(orderId);
  }

  async function loadDetail(orderId: string) {
    setDetailLoadingId(orderId);
    setDetailError((current) => ({ ...current, [orderId]: '' }));
    try {
      const detail = await getMyOrderDetail(orderId);
      setDetailsById((current) => ({ ...current, [orderId]: detail }));
    } catch (failure: unknown) {
      setDetailError((current) => ({
        ...current,
        [orderId]:
          failure instanceof OrdersApiError
            ? failure.message
            : 'No pudimos cargar el detalle de este pedido.',
      }));
    } finally {
      setDetailLoadingId((current) => (current === orderId ? null : current));
    }
  }

  async function handlePay(orderId: string) {
    if (!demoPayments || payingId || cancellingId) return;
    setPayingId(orderId);
    setActionMessage('');
    setError('');

    let operationId = payOperationKeys.current.get(orderId);
    if (!operationId) {
      operationId = crypto.randomUUID();
      payOperationKeys.current.set(orderId, operationId);
    }

    try {
      const updated = await payMyOrder(orderId, operationId);
      payOperationKeys.current.delete(orderId);
      setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
      setDetailsById((current) => {
        const existing = current[updated.id];
        if (!existing) return current;
        return { ...current, [updated.id]: { ...existing, ...updated, history: [] } };
      });
      if (expandedOrderId === updated.id) void loadDetail(updated.id);
      setConfirmingCancelId((current) => (current === updated.id ? null : current));
      setActionMessage(`Pago simulado para la solicitud ${updated.orderNumber}. No se realizó ningún cargo.`);
    } catch (failure: unknown) {
      setError(
        failure instanceof OrdersApiError
          ? failure.message
          : 'No pudimos confirmar el pago del pedido. Inténtalo de nuevo.',
      );
    } finally {
      setPayingId(null);
    }
  }

  async function handleCancel(orderId: string) {
    if (cancellingId) return;
    setCancellingId(orderId);
    setActionMessage('');
    setError('');

    let operationId = cancelOperationKeys.current.get(orderId);
    if (!operationId) {
      operationId = crypto.randomUUID();
      cancelOperationKeys.current.set(orderId, operationId);
    }

    try {
      const updated = await cancelMyOrder(orderId, operationId);
      cancelOperationKeys.current.delete(orderId);
      setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
      setDetailsById((current) => {
        const existing = current[updated.id];
        if (!existing) return current;
        return { ...current, [updated.id]: { ...existing, ...updated, history: [] } };
      });
      if (expandedOrderId === updated.id) void loadDetail(updated.id);
      setConfirmingCancelId(null);
      setActionMessage(`La solicitud ${updated.orderNumber} fue cancelada y su stock quedó liberado.`);
      onOrderCancelled?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof OrdersApiError
          ? failure.message
          : 'No pudimos cancelar el pedido. Inténtalo de nuevo.',
      );
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="orders-section" aria-label="Mis pedidos">
      <div className="orders-toolbar">
        <div>
          <h2 className="orders-title">Mis pedidos</h2>
          <p className="orders-subtitle">
            {modoSimple
              ? 'Aquí puede revisar sus solicitudes de medicamentos y su estado actual.'
              : 'Revisa el estado de tus solicitudes, recetas en revisión, pagos pendientes y detalle.'}
          </p>
        </div>
        <div className="orders-toolbar-actions">
          <button
            type="button"
            className="btn-secundario"
            disabled={loading}
            onClick={() => void loadOrders()}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            type="button"
            className="btn-agregar"
            onClick={onBackToCatalog}
          >
            ← Volver al catálogo
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="alerta-pedido-exito" role="status">
          {actionMessage}
        </div>
      )}

      {error && (
        <div className="carrito-alerta-error" role="alert">
          {error}
        </div>
      )}

      {loading && orders.length === 0 ? (
        <p className="orders-empty" role="status">Cargando tus pedidos…</p>
      ) : orders.length === 0 && !error ? (
        <div className="orders-empty-box">
          <p className="orders-empty">Aún no tienes solicitudes registradas en tu cuenta.</p>
          <button type="button" className="btn-agregar" onClick={onBackToCatalog}>
            Explorar catálogo de medicamentos
          </button>
        </div>
      ) : (
        <ul className="orders-list">
          {orders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const detail = detailsById[order.id];
            const isLoadingDetail = detailLoadingId === order.id;
            const orderDetailError = detailError[order.id];
            const isConfirmingCancel = confirmingCancelId === order.id;
            const isCancelling = cancellingId === order.id;
            const canCancel = order.status === 'pending_payment' || order.status === 'pending_review';

            return (
              <li key={order.id} className="order-card">
                <div className="order-card-header">
                  <div>
                    <span className="order-number">{order.orderNumber}</span>
                    <span className="order-date"> · {formatDateTime(order.createdAt)}</span>
                  </div>
                  <span className={`order-status-badge status-${order.status}`}>
                    {statusLabel(order.status, order.fulfillmentMethod)}
                  </span>
                </div>

                <div className="order-card-summary">
                  <div>
                    <span className="order-meta-label">Modalidad: </span>
                    <strong>
                      {order.fulfillmentMethod === 'pickup'
                        ? 'Retiro en farmacia'
                        : 'Despacho a domicilio'}
                    </strong>
                    {order.status === 'pending_review' && (
                      <p className="order-review-note">
                        Stock reservado mientras la farmacia revisa tu receta. Te avisaremos por correo.
                      </p>
                    )}
                    {order.status === 'pending_payment' && order.reservationExpiresAt && (
                      <p className="order-expiry">
                        Reserva vigente hasta: {formatDateTime(order.reservationExpiresAt)}
                      </p>
                    )}
                    {order.status === 'pending_payment' && !demoPayments && (
                      <p className="order-expiry">El pago en línea todavía no está disponible.</p>
                    )}
                    {order.status === 'rejected' && (
                      <p className="order-rejected-note">
                        Receta no aprobada (stock liberado). Abre «Ver detalle» para revisar el motivo.
                      </p>
                    )}
                  </div>
                  <div className="order-total">
                    <span className="order-meta-label">Total</span>
                    <strong>{formatClp(order.totalClp)}</strong>
                  </div>
                </div>

                <div className="order-card-actions">
                  <button
                    type="button"
                    className="btn-secundario"
                    aria-expanded={isExpanded}
                    onClick={() => void toggleDetail(order.id)}
                  >
                    {isExpanded ? 'Ocultar detalle' : 'Ver detalle y seguimiento'}
                  </button>

                  {demoPayments && order.status === 'pending_payment' && !isConfirmingCancel && (
                    <button
                      type="button"
                      className="btn-agregar"
                      disabled={Boolean(payingId || cancellingId)}
                      onClick={() => void handlePay(order.id)}
                    >
                      {payingId === order.id ? 'Simulando pago…' : 'Simular pago'}
                    </button>
                  )}

                  {canCancel && !isConfirmingCancel && (
                    <button
                      type="button"
                      className="btn-peligro-suave"
                      disabled={Boolean(cancellingId || payingId)}
                      onClick={() => setConfirmingCancelId(order.id)}
                    >
                      Cancelar solicitud
                    </button>
                  )}
                </div>

                {isConfirmingCancel && (
                  <div className="order-cancel-confirm" role="region" aria-label="Confirmar cancelación">
                    <p>¿Seguro que deseas cancelar la solicitud {order.orderNumber}? El stock reservado se liberará.</p>
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="button"
                        className="btn-peligro"
                        disabled={isCancelling}
                        onClick={() => void handleCancel(order.id)}
                      >
                        {isCancelling ? 'Cancelando…' : 'Sí, cancelar'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isCancelling}
                        onClick={() => setConfirmingCancelId(null)}
                      >
                        No, mantener
                      </button>
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="order-detail-box">
                    {isLoadingDetail ? (
                      <p role="status">Cargando detalle del pedido…</p>
                    ) : orderDetailError ? (
                      <p className="carrito-alerta-error" role="alert">{orderDetailError}</p>
                    ) : detail ? (
                      <>
                        {detail.history && detail.history.length > 0 && (
                          <section aria-label="Seguimiento del pedido">
                            <h3 className="order-detail-heading">Seguimiento del pedido</h3>
                            <ol className="order-history">
                              {detail.history.map(({ status, occurredAt }) => (
                                <li key={status}>
                                  <strong>{statusLabel(status, detail.fulfillmentMethod)}</strong>
                                  {' · '}<time dateTime={occurredAt}>{formatDateTime(occurredAt)}</time>
                                </li>
                              ))}
                            </ol>
                          </section>
                        )}
                        <h3 className="order-detail-heading">Medicamentos solicitados</h3>
                        <ul className="order-items-list">
                          {detail.items.map((item) => (
                            <li key={item.productId} className="order-item-row">
                              <div>
                                <strong>{item.name}</strong>
                                <span className="order-item-sub">
                                  {item.quantity} × {formatClp(item.unitPriceClp)} ({item.quantityUnit})
                                </span>
                              </div>
                              <strong>{formatClp(BigInt(item.unitPriceClp) * BigInt(item.quantity))}</strong>
                            </li>
                          ))}
                        </ul>

                        {detail.prescription && (
                          <div className="order-prescription-box">
                            <h3 className="order-detail-heading">Receta médica adjunta</h3>
                            <div className="order-prescription-row">
                              <div>
                                <strong>{detail.prescription.fileName}</strong>
                                <span className="order-item-sub">
                                  {formatFileSize(detail.prescription.fileSizeBytes)} ·{' '}
                                  {PRESCRIPTION_STATUS_LABELS[detail.prescription.status]}
                                </span>
                              </div>
                              <a
                                href={myPrescriptionDownloadUrl(order.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-secundario btn-link-receta"
                              >
                                Ver receta adjunta
                              </a>
                            </div>
                            {detail.prescription.rejectionReason && (
                              <div className="receta-rejection-box" role="alert">
                                <strong>Motivo del rechazo:</strong> {detail.prescription.rejectionReason}
                              </div>
                            )}
                          </div>
                        )}

                        {detail.deliveryDetails && (
                          <div className="order-delivery-info">
                            <h3 className="order-detail-heading">Datos de despacho</h3>
                            <p><strong>Recibe:</strong> {detail.deliveryDetails.recipientName}</p>
                            <p><strong>Teléfono:</strong> {detail.deliveryDetails.phone}</p>
                            <p>
                              <strong>Dirección:</strong> {detail.deliveryDetails.address}, {detail.deliveryDetails.commune}
                            </p>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
