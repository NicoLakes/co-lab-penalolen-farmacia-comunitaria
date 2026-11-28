import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  adjustStaffProductStock,
  createStaffProduct,
  deleteStaffProduct,
  listStaffStock,
  SALE_CONDITION_LABELS,
  StaffStockApiError,
  updateStaffProduct,
} from './staff-stock.api';
import type { SaleCondition, StaffStockItem } from './staff-stock.api';

interface StockPanelProps {
  onCatalogChanged?: (() => void) | undefined;
}

const SALE_CONDITION_OPTIONS: readonly SaleCondition[] = [
  'direct_sale',
  'simple_prescription',
  'retained_prescription',
  'retained_prescription_stock_control',
  'prescription_cheque',
  'not_applicable',
];

interface EditDraft {
  name: string;
  description: string;
  activeIngredient: string;
  dosageForm: string;
  presentation: string;
  supplierName: string;
  therapeuticCategoryName: string;
  priceClp: string;
  saleCondition: SaleCondition | '';
}

function emptyCreateForm() {
  return {
    code: '',
    name: '',
    description: '',
    quantityUnit: 'caja',
    activeIngredient: '',
    dosageForm: '',
    presentation: '',
    supplierName: '',
    therapeuticCategoryName: '',
    priceClp: '',
    saleCondition: 'direct_sale' as SaleCondition | '',
    isPublished: true,
    initialStock: '0',
  };
}

export function StockPanel({ onCatalogChanged }: StockPanelProps) {
  const [items, setItems] = useState<StaffStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'published' | 'hidden'>('all');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);

  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<'add' | 'remove'>('add');
  const [adjustAmount, setAdjustAmount] = useState('1');
  const [adjustReason, setAdjustReason] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void listStaffStock(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result);
        setError('');
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof StaffStockApiError
            ? failure.message
            : 'No pudimos cargar el stock. Revisa tu conexión e inténtalo de nuevo.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshTick]);

  function handleRefresh() {
    setLoading(true);
    setError('');
    setRefreshTick((tick) => tick + 1);
  }

  function replaceItem(updated: StaffStockItem) {
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item))
        .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
    );
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setError('');
    setStatusMessage('');

    const parsedPrice = createForm.priceClp.trim() ? Number(createForm.priceClp) : null;
    const parsedStock = Number(createForm.initialStock || '0');
    if (parsedPrice !== null && (!Number.isInteger(parsedPrice) || parsedPrice <= 0)) {
      setError('El precio debe ser un número entero positivo en CLP.');
      return;
    }
    if (!Number.isInteger(parsedStock) || parsedStock < 0) {
      setError('El stock inicial debe ser un número entero mayor o igual a 0.');
      return;
    }
    if (createForm.isPublished && (parsedPrice === null || !createForm.saleCondition)) {
      setError('Para publicar el producto de inmediato debes indicar precio CLP y condición de venta.');
      return;
    }

    setCreating(true);
    try {
      const created = await createStaffProduct({
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        description: createForm.description.trim() || null,
        quantityUnit: createForm.quantityUnit.trim() || 'unidad',
        activeIngredient: createForm.activeIngredient.trim() || null,
        dosageForm: createForm.dosageForm.trim() || null,
        presentation: createForm.presentation.trim() || null,
        supplierName: createForm.supplierName.trim() || null,
        therapeuticCategoryName: createForm.therapeuticCategoryName.trim() || null,
        priceClp: parsedPrice,
        saleCondition: createForm.saleCondition || null,
        isPublished: createForm.isPublished,
        initialStock: parsedStock,
        operationId: crypto.randomUUID(),
      });
      setItems((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
      );
      setCreateForm(emptyCreateForm());
      setShowCreateForm(false);
      setStatusMessage(`Producto "${created.name}" (${created.code}) creado correctamente.`);
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffStockApiError ? failure.message : 'No pudimos crear el producto.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleStockSubmit(event: FormEvent<HTMLFormElement>, item: StaffStockItem) {
    event.preventDefault();
    if (busyProductId) return;
    setError('');
    setStatusMessage('');

    const units = Number(adjustAmount);
    if (!Number.isInteger(units) || units <= 0) {
      setError('Ingresa una cantidad entera mayor a 0.');
      return;
    }
    const reason = adjustReason.trim();
    if (!reason) {
      setError('Ingresa un motivo breve para el registro de auditoría.');
      return;
    }

    const quantityDelta = adjustMode === 'add' ? units : -units;
    setBusyProductId(item.id);
    try {
      const updated = await adjustStaffProductStock(item.id, {
        operationId: crypto.randomUUID(),
        quantityDelta,
        reason,
        movementType: adjustMode === 'add' ? 'receipt' : 'adjustment',
      });
      replaceItem(updated);
      setAdjustingId(null);
      setAdjustAmount('1');
      setAdjustReason('');
      setStatusMessage(
        `Stock de "${updated.name}" actualizado: ${updated.onHandQuantity} físico (${updated.availableQuantity} disponible).`,
      );
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffStockApiError
          ? failure.message
          : 'No pudimos registrar el movimiento de stock.',
      );
    } finally {
      setBusyProductId(null);
    }
  }

  function startEditing(item: StaffStockItem) {
    setAdjustingId(null);
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditDraft({
      name: item.name,
      description: item.description ?? '',
      activeIngredient: item.activeIngredient ?? '',
      dosageForm: item.dosageForm ?? '',
      presentation: item.presentation ?? '',
      supplierName: item.supplier ?? '',
      therapeuticCategoryName: item.therapeuticCategory ?? '',
      priceClp: item.priceClp !== null ? String(item.priceClp) : '',
      saleCondition: item.saleCondition ?? '',
    });
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>, item: StaffStockItem) {
    event.preventDefault();
    if (!editDraft || busyProductId) return;
    setError('');
    setStatusMessage('');

    const parsedPrice = editDraft.priceClp.trim() ? Number(editDraft.priceClp) : null;
    if (parsedPrice !== null && (!Number.isInteger(parsedPrice) || parsedPrice <= 0)) {
      setError('El precio debe ser un entero positivo en CLP.');
      return;
    }

    setBusyProductId(item.id);
    try {
      const updated = await updateStaffProduct(item.id, {
        name: editDraft.name.trim(),
        description: editDraft.description.trim() || null,
        activeIngredient: editDraft.activeIngredient.trim() || null,
        dosageForm: editDraft.dosageForm.trim() || null,
        presentation: editDraft.presentation.trim() || null,
        supplierName: editDraft.supplierName.trim() || null,
        therapeuticCategoryName: editDraft.therapeuticCategoryName.trim() || null,
        priceClp: parsedPrice,
        saleCondition: editDraft.saleCondition || null,
      });
      replaceItem(updated);
      setEditingId(null);
      setEditDraft(null);
      setStatusMessage(`Datos de "${updated.name}" actualizados.`);
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffStockApiError ? failure.message : 'No pudimos guardar los cambios.',
      );
    } finally {
      setBusyProductId(null);
    }
  }

  async function handleToggleVisibility(item: StaffStockItem) {
    if (busyProductId) return;
    setBusyProductId(item.id);
    setError('');
    setStatusMessage('');
    try {
      const updated = await updateStaffProduct(item.id, { isPublished: !item.isPublished });
      replaceItem(updated);
      setStatusMessage(
        updated.isPublished
          ? `"${updated.name}" ahora está visible en el catálogo de vecinos.`
          : `"${updated.name}" fue ocultado del catálogo de vecinos.`,
      );
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setError(
        failure instanceof StaffStockApiError
          ? failure.message
          : 'No pudimos cambiar la visibilidad del producto.',
      );
    } finally {
      setBusyProductId(null);
    }
  }

  async function handleDelete(item: StaffStockItem) {
    if (busyProductId) return;
    setBusyProductId(item.id);
    setError('');
    setStatusMessage('');
    try {
      await deleteStaffProduct(item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      setConfirmDeleteId(null);
      setStatusMessage(`Producto "${item.name}" (${item.code}) eliminado.`);
      onCatalogChanged?.();
    } catch (failure: unknown) {
      setConfirmDeleteId(null);
      setError(
        failure instanceof StaffStockApiError ? failure.message : 'No pudimos eliminar el producto.',
      );
    } finally {
      setBusyProductId(null);
    }
  }

  const filteredItems = items.filter((item) => {
    if (visibilityFilter === 'published' && !item.isPublished) return false;
    if (visibilityFilter === 'hidden' && item.isPublished) return false;
    const text = search.trim().toLowerCase();
    if (!text) return true;
    return (
      item.name.toLowerCase().includes(text)
      || item.code.toLowerCase().includes(text)
      || (item.activeIngredient?.toLowerCase().includes(text) ?? false)
      || (item.therapeuticCategory?.toLowerCase().includes(text) ?? false)
    );
  });

  return (
    <div className="admin-panel-content">
      <div className="admin-section-intro">
        <div>
          <h3 className="admin-subheading">Gestión de stock y catálogo</h3>
          <p className="orders-subtitle">
            Agrega productos, ajusta existencias con registro de auditoría, oculta ítems o elimina borradores sin historial.
          </p>
        </div>
        <div className="orders-toolbar-actions">
          <button
            type="button"
            className="btn-agregar"
            onClick={() => {
              setShowCreateForm((open) => !open);
              setError('');
            }}
          >
            {showCreateForm ? 'Cerrar formulario' : '+ Agregar producto'}
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

      {showCreateForm && (
        <form className="admin-create-card" onSubmit={(event) => void handleCreateSubmit(event)}>
          <h4 className="admin-create-title">Nuevo producto</h4>
          <div className="stock-form-grid">
            <label className="stock-field">
              <span>Código *</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: 15800"
                maxLength={64}
                required
                disabled={creating}
                value={createForm.code}
                onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Nombre *</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: PARACETAMOL 500 MG"
                maxLength={300}
                required
                disabled={creating}
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Principio activo</span>
              <input
                type="text"
                className="input-busqueda"
                maxLength={300}
                disabled={creating}
                value={createForm.activeIngredient}
                onChange={(e) => setCreateForm({ ...createForm, activeIngredient: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Descripción</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: PARACETAMOL 500 MG X 16 COMP"
                maxLength={300}
                disabled={creating}
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Presentación</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: 16 comprimidos"
                maxLength={300}
                disabled={creating}
                value={createForm.presentation}
                onChange={(e) => setCreateForm({ ...createForm, presentation: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Forma farmacéutica</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: COMPRIMIDO"
                maxLength={300}
                disabled={creating}
                value={createForm.dosageForm}
                onChange={(e) => setCreateForm({ ...createForm, dosageForm: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Laboratorio / Proveedor</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: MINTLAB"
                maxLength={300}
                disabled={creating}
                value={createForm.supplierName}
                onChange={(e) => setCreateForm({ ...createForm, supplierName: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Categoría terapéutica</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: ANALGESICO"
                maxLength={300}
                disabled={creating}
                value={createForm.therapeuticCategoryName}
                onChange={(e) => setCreateForm({ ...createForm, therapeuticCategoryName: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Unidad de venta *</span>
              <input
                type="text"
                className="input-busqueda"
                placeholder="Ej: caja, frasco"
                maxLength={64}
                required
                disabled={creating}
                value={createForm.quantityUnit}
                onChange={(e) => setCreateForm({ ...createForm, quantityUnit: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Precio CLP</span>
              <input
                type="number"
                className="input-busqueda"
                min={1}
                step={1}
                placeholder="Ej: 1490"
                disabled={creating}
                value={createForm.priceClp}
                onChange={(e) => setCreateForm({ ...createForm, priceClp: e.target.value })}
              />
            </label>
            <label className="stock-field">
              <span>Condición de venta</span>
              <select
                className="input-busqueda"
                disabled={creating}
                value={createForm.saleCondition}
                onChange={(e) => setCreateForm({ ...createForm, saleCondition: e.target.value as SaleCondition | '' })}
              >
                <option value="">Sin definir (borrador)</option>
                {SALE_CONDITION_OPTIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {SALE_CONDITION_LABELS[condition]}
                  </option>
                ))}
              </select>
            </label>
            <label className="stock-field">
              <span>Stock inicial</span>
              <input
                type="number"
                className="input-busqueda"
                min={0}
                step={1}
                disabled={creating}
                value={createForm.initialStock}
                onChange={(e) => setCreateForm({ ...createForm, initialStock: e.target.value })}
              />
            </label>
          </div>
          <div className="stock-form-footer">
            <label className="admin-checkbox-label">
              <input
                type="checkbox"
                checked={createForm.isPublished}
                disabled={creating}
                onChange={(e) => setCreateForm({ ...createForm, isPublished: e.target.checked })}
              />
              <span>Publicar inmediatamente en el catálogo</span>
            </label>
            <div className="orders-toolbar-actions">
              <button type="submit" className="btn-agregar" disabled={creating}>
                {creating ? 'Guardando…' : 'Guardar producto'}
              </button>
              <button
                type="button"
                className="btn-secundario"
                disabled={creating}
                onClick={() => setShowCreateForm(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="stock-filters-bar">
        <input
          type="search"
          className="input-busqueda"
          aria-label="Buscar producto por código, nombre o categoría"
          placeholder="Buscar por código, nombre, principio activo o categoría…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="stock-filter-chips" role="group" aria-label="Filtrar por visibilidad">
          {([
            ['all', `Todos (${items.length})`],
            ['published', `Publicados (${items.filter((i) => i.isPublished).length})`],
            ['hidden', `Ocultos (${items.filter((i) => !i.isPublished).length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={visibilityFilter === key ? 'chip activo' : 'chip'}
              onClick={() => setVisibilityFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
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

      {loading && items.length === 0 ? (
        <p className="orders-empty" role="status">Cargando inventario…</p>
      ) : filteredItems.length === 0 ? (
        <p className="orders-empty">No hay productos que coincidan con el filtro actual.</p>
      ) : (
        <ul className="admin-users-list">
          {filteredItems.map((item) => {
            const isBusy = busyProductId === item.id;
            const isAdjusting = adjustingId === item.id;
            const isEditing = editingId === item.id && editDraft !== null;
            const isConfirmingDelete = confirmDeleteId === item.id;

            return (
              <li key={item.id} className={item.isPublished ? 'admin-user-card' : 'admin-user-card stock-card-hidden'}>
                <div className="admin-user-header">
                  <div>
                    <span className="stock-code-pill">#{item.code}</span>
                    <strong className="admin-user-email">{item.name}</strong>
                    {item.therapeuticCategory && (
                      <span className="stock-meta-inline"> · {item.therapeuticCategory}</span>
                    )}
                  </div>
                  <div className="stock-badges">
                    <span className={item.isPublished ? 'order-status-badge status-fulfilled' : 'order-status-badge status-cancelled'}>
                      {item.isPublished ? 'Publicado' : 'Oculto'}
                    </span>
                    <span className="admin-role-chip role-none">
                      {item.saleCondition ? SALE_CONDITION_LABELS[item.saleCondition] : 'Sin condición'}
                    </span>
                  </div>
                </div>

                {item.description && <p className="stock-description">{item.description}</p>}

                <div className="stock-metrics">
                  <div>
                    <span className="order-meta-label">Precio CLP</span>
                    <strong>{item.priceClp !== null ? `$${item.priceClp.toLocaleString('es-CL')}` : 'Sin precio'}</strong>
                  </div>
                  <div>
                    <span className="order-meta-label">Stock físico</span>
                    <strong>{item.onHandQuantity}</strong>
                  </div>
                  <div>
                    <span className="order-meta-label">Reservado</span>
                    <strong>{item.reservedQuantity}</strong>
                  </div>
                  <div>
                    <span className="order-meta-label">Disponible</span>
                    <strong className={item.availableQuantity === 0 ? 'stock-zero' : ''}>
                      {item.availableQuantity}
                    </strong>
                  </div>
                </div>

                <div className="admin-user-actions">
                  <button
                    type="button"
                    className="btn-agregar"
                    disabled={isBusy}
                    onClick={() => {
                      setEditingId(null);
                      setEditDraft(null);
                      setConfirmDeleteId(null);
                      setAdjustingId(isAdjusting ? null : item.id);
                      setAdjustMode('add');
                      setAdjustAmount('1');
                      setAdjustReason('');
                    }}
                  >
                    {isAdjusting ? 'Cerrar ajuste' : 'Ajustar stock'}
                  </button>
                  <button
                    type="button"
                    className="btn-secundario"
                    disabled={isBusy}
                    onClick={() => (isEditing ? (setEditingId(null), setEditDraft(null)) : startEditing(item))}
                  >
                    {isEditing ? 'Cerrar edición' : 'Editar datos'}
                  </button>
                  <button
                    type="button"
                    className="btn-secundario"
                    disabled={isBusy}
                    onClick={() => void handleToggleVisibility(item)}
                  >
                    {item.isPublished ? 'Ocultar del catálogo' : 'Publicar en catálogo'}
                  </button>
                  {!isConfirmingDelete && (
                    <button
                      type="button"
                      className="btn-peligro-suave"
                      disabled={isBusy}
                      onClick={() => {
                        setAdjustingId(null);
                        setEditingId(null);
                        setEditDraft(null);
                        setConfirmDeleteId(item.id);
                      }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>

                {isAdjusting && (
                  <form className="stock-inline-box" onSubmit={(event) => void handleStockSubmit(event, item)}>
                    <div className="entrega-opciones">
                      <button
                        type="button"
                        className={adjustMode === 'add' ? 'chip activo' : 'chip'}
                        onClick={() => setAdjustMode('add')}
                      >
                        + Ingresar unidades
                      </button>
                      <button
                        type="button"
                        className={adjustMode === 'remove' ? 'chip activo' : 'chip'}
                        onClick={() => setAdjustMode('remove')}
                      >
                        − Descontar unidades
                      </button>
                    </div>
                    <div className="stock-adjust-row">
                      <input
                        type="number"
                        className="input-busqueda stock-qty-input"
                        aria-label="Cantidad de unidades"
                        min={1}
                        step={1}
                        required
                        disabled={isBusy}
                        value={adjustAmount}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                      />
                      <input
                        type="text"
                        className="input-busqueda"
                        aria-label="Motivo del movimiento"
                        placeholder={adjustMode === 'add' ? 'Motivo (ej: Reposición bodega)' : 'Motivo (ej: Ajuste de conteo o merma)'}
                        maxLength={300}
                        required
                        disabled={isBusy}
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                      />
                      <button type="submit" className="btn-agregar" disabled={isBusy}>
                        {isBusy ? 'Guardando…' : 'Aplicar'}
                      </button>
                    </div>
                  </form>
                )}

                {isEditing && editDraft && (
                  <form className="stock-inline-box" onSubmit={(event) => void handleEditSubmit(event, item)}>
                    <div className="stock-form-grid">
                      <label className="stock-field">
                        <span>Nombre *</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          required
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.name}
                          onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Descripción</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.description}
                          onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Principio activo</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.activeIngredient}
                          onChange={(e) => setEditDraft({ ...editDraft, activeIngredient: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Presentación</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.presentation}
                          onChange={(e) => setEditDraft({ ...editDraft, presentation: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Proveedor</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.supplierName}
                          onChange={(e) => setEditDraft({ ...editDraft, supplierName: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Categoría</span>
                        <input
                          type="text"
                          className="input-busqueda"
                          maxLength={300}
                          disabled={isBusy}
                          value={editDraft.therapeuticCategoryName}
                          onChange={(e) => setEditDraft({ ...editDraft, therapeuticCategoryName: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Precio CLP</span>
                        <input
                          type="number"
                          className="input-busqueda"
                          min={1}
                          step={1}
                          disabled={isBusy}
                          value={editDraft.priceClp}
                          onChange={(e) => setEditDraft({ ...editDraft, priceClp: e.target.value })}
                        />
                      </label>
                      <label className="stock-field">
                        <span>Condición de venta</span>
                        <select
                          className="input-busqueda"
                          disabled={isBusy}
                          value={editDraft.saleCondition}
                          onChange={(e) => setEditDraft({ ...editDraft, saleCondition: e.target.value as SaleCondition | '' })}
                        >
                          <option value="">Sin definir</option>
                          {SALE_CONDITION_OPTIONS.map((condition) => (
                            <option key={condition} value={condition}>
                              {SALE_CONDITION_LABELS[condition]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="orders-toolbar-actions">
                      <button type="submit" className="btn-agregar" disabled={isBusy}>
                        {isBusy ? 'Guardando…' : 'Guardar cambios'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft(null);
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {isConfirmingDelete && (
                  <div className="order-cancel-confirm" role="region" aria-label="Confirmar eliminación">
                    <p>
                      ¿Eliminar definitivamente <strong>{item.name}</strong> (#{item.code})? Solo se permite si no tiene movimientos ni pedidos registrados.
                    </p>
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="button"
                        className="btn-peligro"
                        disabled={isBusy}
                        onClick={() => void handleDelete(item)}
                      >
                        {isBusy ? 'Eliminando…' : 'Sí, eliminar'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancelar
                      </button>
                    </div>
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
