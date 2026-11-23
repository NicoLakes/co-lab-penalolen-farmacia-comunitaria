import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { PrescriptionReviewStatus } from '../orders/orders.api';
import {
  approveStaffPrescription,
  createInPersonOrder,
  fulfillStaffOrder,
  getFulfillmentOrderDetail,
  IN_PERSON_PAYMENT_LABELS,
  listFulfillmentOrders,
  rejectStaffPrescription,
  StaffOrdersApiError,
  staffPrescriptionDownloadUrl,
} from './staff-orders.api';
import type {
  InPersonPaymentMethod,
  StaffOrderDetail,
  StaffOrderStatusFilter,
  StaffOrderSummary,
} from './staff-orders.api';
import { listStaffStock } from './staff-stock.api';
import type { StaffStockItem } from './staff-stock.api';

interface StaffOrdersPanelProps {
  onCatalogChanged?: (() => void) | undefined;
}

interface ManualSaleLine {
  product: StaffStockItem;
  quantity: number;
}

const PAYMENT_OPTIONS: readonly InPersonPaymentMethod[] = ['cash', 'card', 'bank_transfer'];

const STATUS_BADGE_LABELS: Record<StaffOrderStatusFilter, string> = {
  pending_review: 'Por revisar receta',
  confirmed: 'Pagado · Por entregar',
  fulfilled: 'Entregado',
  rejected: 'Receta rechazada',
};

const PRESCRIPTION_STATUS_LABELS: Record<PrescriptionReviewStatus, string> = {
  pending: 'Pendiente de revisión',
  approved: 'Aprobada',
  rejected: 'Rechazada',
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

export function StaffOrdersPanel({ onCatalogChanged }: StaffOrdersPanelProps) {
  const [statusTab, setStatusTab] = useState<StaffOrderStatusFilter>('pending_review');
  const [orders, setOrders] = useState<StaffOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [search, setSearch] = useState('');

  const [showManualForm, setShowManualForm] = useState(false);
  const [stockCatalog, setStockCatalog] = useState<StaffStockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lineQuantity, setLineQuantity] = useState('1');
  const [manualLines, setManualLines] = useState<ManualSaleLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<InPersonPaymentMethod>('card');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [creatingManual, setCreatingManual] = useState(false);

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, StaffOrderDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const [confirmFulfillId, setConfirmFulfillId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [rejectingFormId, setRejectingFormId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const fulfillKeys = useRef<Map<string, string>>(new Map());
  const approveKeys = useRef<Map<string, string>>(new Map());
  const rejectKeys = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    void listFulfillmentOrders(statusTab, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setOrders(result);
        setError('');
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof StaffOrdersApiError
            ? failure.message
            : 'No pudimos cargar los pedidos. Revisa tu conexión e inténtalo de nuevo.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [statusTab, refreshTick]);

  useEffect(() => {
    if (!showManualForm) return;
    const controller = new AbortController();
    void listStaffStock(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        const sellable = items.filter(
          (item) => item.priceClp !== null && item.saleCondition !== null && item.availableQuantity > 0,
        );
        setStockCatalog(sellable);
        setSelectedProductId((current) =>
          sellable.some((item) => item.id === current) ? current : (sellable[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('No pudimos cargar el stock disponible para venta presencial.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStockLoading(false);
      });
    return () => controller.abort();
  }, [showManualForm, refreshTick]);

  function handleTabChange(nextTab: StaffOrderStatusFilter) {
    if (nextTab === statusTab) return;
    setLoading(true);
    setError('');
    setStatusMessage('');
    setExpandedOrderId(null);
    setConfirmFulfillId(null);
    setConfirmApproveId(null);
    setRejectingFormId(null);
    setRejectionReason('');
    setStatusTab(nextTab);
  }

  function handleRefresh() {
    setLoading(true);
    setError('');
    setRefreshTick((tick) => tick + 1);
  }

  function handleAddManualLine() {
    setError('');
    const product = stockCatalog.find((item) => item.id === selectedProductId);
    const qty = Number(lineQuantity);
    if (!product) {
      setError('Selecciona un medicamento con stock disponible.');
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Ingresa una cantidad entera mayor a 0.');
      return;
    }
    setManualLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        const nextQty = Math.min(existing.quantity + qty, product.availableQuantity);
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: nextQty } : line,
        );
      }
      return [...current, { product, quantity: Math.min(qty, product.availableQuantity) }];
    });
    setLineQuantity('1');
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingManual) return;
    setError('');
    setStatusMessage('');

    if (manualLines.length === 0) {
      setError('Agrega al menos un medicamento a la venta presencial.');
      return;
    }

    setCreatingManual(true);
    try {
      const created = await createInPersonOrder({
        idempotencyKey: crypto.randomUUID(),
        buyerEmail: buyerEmail.trim() || null,
        paymentMethod,
        items: manualLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      });
      setManualLines([]);
      setBuyerEmail('');
      setShowManualForm(false);
      setStatusMessage(
        `Venta presencial ${created.orderNumber} registrada (${IN_PERSON_PAYMENT_LABELS[paymentMethod]}) por ${formatClp(created.totalClp)}. Pasó automáticamente a Entregados y se descontó del stock.`,
      );
      if (statusTab === 'fulfilled') {
        setOrders((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      } else {
        setLoading(true);
        setStatusTab('fulfilled');
      }
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffOrdersApiError
          ? failure.message
          : 'No pudimos registrar la venta presencial.',
      );
    } finally {
      setCreatingManual(false);
    }
  }

  async function toggleDetail(orderId: string) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }
    setExpandedOrderId(orderId);
    if (detailsById[orderId]) return;

    setDetailLoadingId(orderId);
    setDetailErrors((current) => ({ ...current, [orderId]: '' }));
    try {
      const detail = await getFulfillmentOrderDetail(orderId);
      setDetailsById((current) => ({ ...current, [orderId]: detail }));
    } catch (failure: unknown) {
      setDetailErrors((current) => ({
        ...current,
        [orderId]:
          failure instanceof StaffOrdersApiError
            ? failure.message
            : 'No pudimos cargar el detalle de este pedido.',
      }));
    } finally {
      setDetailLoadingId((current) => (current === orderId ? null : current));
    }
  }

  async function handleFulfill(order: StaffOrderSummary) {
    if (busyOrderId) return;
    setBusyOrderId(order.id);
    setError('');
    setStatusMessage('');

    let operationId = fulfillKeys.current.get(order.id);
    if (!operationId) {
      operationId = crypto.randomUUID();
      fulfillKeys.current.set(order.id, operationId);
    }

    try {
      const updated = await fulfillStaffOrder(order.id, operationId);
      fulfillKeys.current.delete(order.id);
      setOrders((current) => current.filter((item) => item.id !== updated.id));
      setDetailsById((current) => {
        const existing = current[updated.id];
        if (!existing) return current;
        return { ...current, [updated.id]: { ...existing, ...updated } };
      });
      setConfirmFulfillId(null);
      setExpandedOrderId((current) => (current === updated.id ? null : current));
      setStatusMessage(
        `Pedido ${updated.orderNumber} marcado como entregado. El stock físico fue descontado y registrado como venta.`,
      );
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffOrdersApiError
          ? failure.message
          : 'No pudimos completar la entrega del pedido.',
      );
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleApprovePrescription(order: StaffOrderSummary) {
    if (busyOrderId) return;
    setBusyOrderId(order.id);
    setError('');
    setStatusMessage('');

    let operationId = approveKeys.current.get(order.id);
    if (!operationId) {
      operationId = crypto.randomUUID();
      approveKeys.current.set(order.id, operationId);
    }

    try {
      const result = await approveStaffPrescription(order.id, operationId);
      approveKeys.current.delete(order.id);
      setOrders((current) => current.filter((item) => item.id !== result.id));
      setConfirmApproveId(null);
      setExpandedOrderId((current) => (current === result.id ? null : current));
      const emailNotice = result.notificationSent
        ? 'Se envió un correo al vecino con el plazo de 3 días para pagar.'
        : 'El pedido quedó listo para pago por 3 días (no se pudo enviar notificación por correo).';
      setStatusMessage(`Receta aprobada para el pedido ${result.orderNumber}. ${emailNotice}`);
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffOrdersApiError
          ? failure.message
          : 'No pudimos aprobar la receta del pedido.',
      );
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleRejectPrescription(event: FormEvent<HTMLFormElement>, order: StaffOrderSummary) {
    event.preventDefault();
    if (busyOrderId) return;
    const trimmedReason = rejectionReason.trim();
    if (!trimmedReason) {
      setError('Indica un motivo para rechazar la receta.');
      return;
    }

    setBusyOrderId(order.id);
    setError('');
    setStatusMessage('');

    let operationId = rejectKeys.current.get(order.id);
    if (!operationId) {
      operationId = crypto.randomUUID();
      rejectKeys.current.set(order.id, operationId);
    }

    try {
      const result = await rejectStaffPrescription(order.id, operationId, trimmedReason);
      rejectKeys.current.delete(order.id);
      setOrders((current) => current.filter((item) => item.id !== result.id));
      setRejectingFormId(null);
      setRejectionReason('');
      setExpandedOrderId((current) => (current === result.id ? null : current));
      const emailNotice = result.notificationSent
        ? 'Se notificó el motivo al vecino por correo.'
        : 'El motivo quedó registrado en Mis pedidos (no se pudo enviar correo).';
      setStatusMessage(
        `Receta rechazada para el pedido ${result.orderNumber}. El stock reservado fue liberado. ${emailNotice}`,
      );
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffOrdersApiError
          ? failure.message
          : 'No pudimos rechazar la receta del pedido.',
      );
    } finally {
      setBusyOrderId(null);
    }
  }

  const manualTotalClp = manualLines.reduce(
    (sum, line) => sum + BigInt(line.product.priceClp ?? 0) * BigInt(line.quantity),
    0n,
  );

  const filteredOrders = orders.filter((order) => {
    const text = search.trim().toLowerCase();
    if (!text) return true;
    return (
      order.orderNumber.toLowerCase().includes(text)
      || (order.buyerEmail?.toLowerCase().includes(text) ?? false)
    );
  });

  const emptyMessageByTab: Record<StaffOrderStatusFilter, string> = {
    pending_review: 'No hay recetas pendientes de revisión en este momento.',
    confirmed: 'No hay pedidos pagados pendientes de entrega en este momento.',
    fulfilled: 'Aún no hay pedidos marcados como entregados.',
    rejected: 'No hay pedidos con receta rechazada.',
  };

  return (
    <div className="admin-panel-content">
      <div className="admin-section-intro">
        <div>
          <h3 className="admin-subheading">Gestión de pedidos</h3>
          <p className="orders-subtitle">
            Revisa recetas adjuntas, entrega pedidos pagados en línea y registra ventas presenciales en mesón.
          </p>
        </div>
        <div className="orders-toolbar-actions">
          <button
            type="button"
            className="btn-agregar"
            onClick={() => {
              const nextOpen = !showManualForm;
              if (nextOpen) setStockLoading(true);
              setShowManualForm(nextOpen);
              setError('');
            }}
          >
            {showManualForm ? 'Cerrar venta presencial' : '+ Registrar venta presencial'}
          </button>
          <button
            type="button"
            className="btn-secundario"
            disabled={loading}
            onClick={handleRefresh}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {showManualForm && (
        <form className="admin-create-card" onSubmit={(event) => void handleManualSubmit(event)}>
          <h4 className="admin-create-title">Venta presencial en farmacia (entrega inmediata)</h4>
          <p className="stock-description">
            Registra una compra pagada en mesón (efectivo, tarjeta o transferencia presencial). El pedido pasa automáticamente a <strong>Entregados</strong> y descuenta stock físico.
          </p>

          {stockLoading && stockCatalog.length === 0 ? (
            <p role="status">Cargando medicamentos con stock disponible…</p>
          ) : stockCatalog.length === 0 ? (
            <p className="orders-empty">No hay medicamentos con precio y stock disponible en este momento.</p>
          ) : (
            <>
              <div className="stock-adjust-row">
                <select
                  className="input-busqueda"
                  aria-label="Seleccionar medicamento"
                  disabled={creatingManual}
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                >
                  {stockCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.code} · {item.name} — {formatClp(item.priceClp ?? 0)} (disp: {item.availableQuantity})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="input-busqueda stock-qty-input"
                  aria-label="Cantidad"
                  min={1}
                  step={1}
                  disabled={creatingManual}
                  value={lineQuantity}
                  onChange={(event) => setLineQuantity(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-secundario"
                  disabled={creatingManual}
                  onClick={handleAddManualLine}
                >
                  + Agregar ítem
                </button>
              </div>

              {manualLines.length > 0 && (
                <ul className="order-items-list" style={{ marginTop: '0.85rem' }}>
                  {manualLines.map((line) => (
                    <li key={line.product.id} className="order-item-row">
                      <div>
                        <strong>{line.product.name}</strong>
                        <span className="order-item-sub">
                          {line.quantity} × {formatClp(line.product.priceClp ?? 0)} (máx. {line.product.availableQuantity})
                        </span>
                      </div>
                      <div className="orders-toolbar-actions">
                        <strong>{formatClp(BigInt(line.product.priceClp ?? 0) * BigInt(line.quantity))}</strong>
                        <button
                          type="button"
                          className="btn-peligro-suave"
                          disabled={creatingManual}
                          onClick={() =>
                            setManualLines((current) =>
                              current.filter((existing) => existing.product.id !== line.product.id),
                            )
                          }
                        >
                          Quitar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="stock-form-grid" style={{ marginTop: '0.9rem' }}>
                <label className="stock-field">
                  <span>Medio de pago presencial *</span>
                  <select
                    className="input-busqueda"
                    disabled={creatingManual}
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value as InPersonPaymentMethod)}
                  >
                    {PAYMENT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {IN_PERSON_PAYMENT_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stock-field">
                  <span>Correo del vecino (opcional)</span>
                  <input
                    type="email"
                    className="input-busqueda"
                    placeholder="Dejar vacío para venta sin cuenta"
                    maxLength={254}
                    disabled={creatingManual}
                    value={buyerEmail}
                    onChange={(event) => setBuyerEmail(event.target.value)}
                  />
                </label>
              </div>

              <div className="stock-form-footer">
                <strong>Total a cobrar: {formatClp(manualTotalClp)}</strong>
                <div className="orders-toolbar-actions">
                  <button
                    type="submit"
                    className="btn-agregar"
                    disabled={creatingManual || manualLines.length === 0}
                  >
                    {creatingManual ? 'Registrando venta…' : 'Registrar venta y entregar'}
                  </button>
                  <button
                    type="button"
                    className="btn-secundario"
                    disabled={creatingManual}
                    onClick={() => setShowManualForm(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      )}

      <div className="stock-filters-bar">
        <div className="stock-filter-chips" role="tablist" aria-label="Estado de pedidos">
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'pending_review'}
            className={statusTab === 'pending_review' ? 'chip activo' : 'chip'}
            onClick={() => handleTabChange('pending_review')}
          >
            Por revisar (receta)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'confirmed'}
            className={statusTab === 'confirmed' ? 'chip activo' : 'chip'}
            onClick={() => handleTabChange('confirmed')}
          >
            Aceptados (pagados)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'fulfilled'}
            className={statusTab === 'fulfilled' ? 'chip activo' : 'chip'}
            onClick={() => handleTabChange('fulfilled')}
          >
            Entregados
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusTab === 'rejected'}
            className={statusTab === 'rejected' ? 'chip activo' : 'chip'}
            onClick={() => handleTabChange('rejected')}
          >
            Rechazados
          </button>
        </div>

        <input
          type="search"
          className="input-busqueda"
          aria-label="Buscar pedido por número o correo del vecino"
          placeholder="Buscar por número de orden (ej: FC-1) o correo del vecino…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {statusMessage && (
        <div className="alerta-pedido-exito" role="status">
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="carrito-alerta-error" role="alert">
          {error}
        </div>
      )}

      {loading && orders.length === 0 ? (
        <p className="orders-empty" role="status">Cargando pedidos…</p>
      ) : filteredOrders.length === 0 ? (
        <p className="orders-empty">{emptyMessageByTab[statusTab]}</p>
      ) : (
        <ul className="orders-list">
          {filteredOrders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const detail = detailsById[order.id];
            const isLoadingDetail = detailLoadingId === order.id;
            const orderDetailError = detailErrors[order.id];
            const isConfirmingFulfill = confirmFulfillId === order.id;
            const isConfirmingApprove = confirmApproveId === order.id;
            const isRejectingForm = rejectingFormId === order.id;
            const isBusy = busyOrderId === order.id;
            const isDelivery = order.fulfillmentMethod === 'delivery';
            const badgeLabel = STATUS_BADGE_LABELS[
              order.status === 'pending_review' || order.status === 'confirmed' || order.status === 'fulfilled' || order.status === 'rejected'
                ? order.status
                : statusTab
            ];

            return (
              <li key={order.id} className="order-card">
                <div className="order-card-header">
                  <div>
                    <span className="order-number">{order.orderNumber}</span>
                    <span className="order-date"> · {formatDateTime(order.createdAt)}</span>
                  </div>
                  <span className={`order-status-badge status-${order.status}`}>
                    {badgeLabel}
                  </span>
                </div>

                <div className="order-card-summary">
                  <div>
                    <p className="staff-order-buyer">
                      <span className="order-meta-label">Vecino: </span>
                      <strong>{order.buyerEmail ?? 'Venta presencial sin cuenta'}</strong>
                    </p>
                    <span className="order-meta-label">Modalidad: </span>
                    <strong>{isDelivery ? 'Despacho a domicilio' : 'Retiro en farmacia'}</strong>
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
                    {isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>

                  {order.status === 'pending_review' && (
                    <>
                      <a
                        href={staffPrescriptionDownloadUrl(order.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secundario btn-link-receta"
                      >
                        Ver receta
                      </a>
                      {!isConfirmingApprove && !isRejectingForm && (
                        <>
                          <button
                            type="button"
                            className="btn-agregar"
                            disabled={Boolean(busyOrderId)}
                            onClick={() => {
                              setConfirmApproveId(order.id);
                              setRejectingFormId(null);
                              setError('');
                            }}
                          >
                            Aprobar receta
                          </button>
                          <button
                            type="button"
                            className="btn-peligro-suave"
                            disabled={Boolean(busyOrderId)}
                            onClick={() => {
                              setRejectingFormId(order.id);
                              setConfirmApproveId(null);
                              setRejectionReason('');
                              setError('');
                            }}
                          >
                            Rechazar receta
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {order.status === 'confirmed' && !isConfirmingFulfill && (
                    <button
                      type="button"
                      className="btn-agregar"
                      disabled={Boolean(busyOrderId)}
                      onClick={() => setConfirmFulfillId(order.id)}
                    >
                      {isDelivery ? 'Marcar como despachado' : 'Marcar como entregado'}
                    </button>
                  )}
                </div>

                {isConfirmingApprove && (
                  <div className="staff-approve-confirm" role="region" aria-label="Confirmar aprobación de receta">
                    <p>
                      ¿Aprobar la receta del pedido <strong>{order.orderNumber}</strong>? El pedido pasará a{' '}
                      <strong>Pendiente de pago</strong> con plazo de 3 días y se enviará un correo al vecino.
                    </p>
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="button"
                        className="btn-agregar"
                        disabled={isBusy}
                        onClick={() => void handleApprovePrescription(order)}
                      >
                        {isBusy ? 'Aprobando…' : 'Sí, aprobar receta'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => setConfirmApproveId(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {isRejectingForm && (
                  <form
                    className="staff-reject-form"
                    onSubmit={(event) => void handleRejectPrescription(event, order)}
                  >
                    <label htmlFor={`reject-reason-${order.id}`}>
                      Motivo del rechazo para el pedido {order.orderNumber} *
                    </label>
                    <textarea
                      id={`reject-reason-${order.id}`}
                      className="staff-reject-textarea"
                      maxLength={500}
                      placeholder="Ej.: Receta ilegible, vencida o no corresponde al medicamento solicitado."
                      disabled={isBusy}
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                    />
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="submit"
                        className="btn-peligro"
                        disabled={isBusy || !rejectionReason.trim()}
                      >
                        {isBusy ? 'Rechazando…' : 'Confirmar rechazo y liberar stock'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => {
                          setRejectingFormId(null);
                          setRejectionReason('');
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {isConfirmingFulfill && (
                  <div className="order-cancel-confirm" role="region" aria-label="Confirmar entrega">
                    <p>
                      ¿Confirmar que el pedido <strong>{order.orderNumber}</strong> fue{' '}
                      {isDelivery ? 'despachado' : 'entregado'}? Se descontará del stock físico y quedará registrado como venta.
                    </p>
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="button"
                        className="btn-agregar"
                        disabled={isBusy}
                        onClick={() => void handleFulfill(order)}
                      >
                        {isBusy ? 'Registrando…' : 'Sí, confirmar entrega'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => setConfirmFulfillId(null)}
                      >
                        Cancelar
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
                        <h4 className="order-detail-heading">Medicamentos solicitados</h4>
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
                            <h4 className="order-detail-heading">Receta médica adjunta</h4>
                            <div className="order-prescription-row">
                              <div>
                                <strong>{detail.prescription.fileName}</strong>
                                <span className="order-item-sub">
                                  {formatFileSize(detail.prescription.fileSizeBytes)} ·{' '}
                                  {PRESCRIPTION_STATUS_LABELS[detail.prescription.status]}
                                </span>
                              </div>
                              <a
                                href={staffPrescriptionDownloadUrl(order.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-secundario btn-link-receta"
                              >
                                Abrir receta adjunta
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
                            <h4 className="order-detail-heading">Datos de despacho</h4>
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
    </div>
  );
}
