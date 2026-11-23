import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AdminMovementsApiError,
  listAdminInventoryMovements,
  MOVEMENT_TYPE_LABELS,
} from './admin-movements.api';
import type { AdminInventoryMovement, AuditMovementType } from './admin-movements.api';

const FILTER_OPTIONS: readonly { value: AuditMovementType | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'receipt', label: 'Ingresos' },
  { value: 'sale', label: 'Ventas' },
  { value: 'adjustment', label: 'Ajustes' },
  { value: 'opening', label: 'Stock inicial' },
  { value: 'transfer_out', label: 'Traslados bodega (salida)' },
  { value: 'transfer_in', label: 'Traslados bodega (entrada)' },
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function StockMovementsPanel() {
  const [movements, setMovements] = useState<AdminInventoryMovement[]>([]);
  const [movementType, setMovementType] = useState<AuditMovementType | ''>('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void listAdminInventoryMovements({ query: appliedQuery, movementType }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setMovements(result);
        setError('');
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof AdminMovementsApiError
            ? failure.message
            : 'No pudimos cargar el historial de movimientos. Revisa tu conexión e inténtalo de nuevo.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedQuery, movementType, refreshTick]);

  function handleRefresh() {
    setLoading(true);
    setError('');
    setRefreshTick((tick) => tick + 1);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const nextQuery = query.trim();
    if (nextQuery === appliedQuery) {
      setRefreshTick((tick) => tick + 1);
    } else {
      setAppliedQuery(nextQuery);
    }
  }

  return (
    <div className="admin-panel-content">
      <div className="admin-section-intro">
        <div>
          <h3 className="admin-subheading">Historial de movimientos de stock</h3>
          <p className="orders-subtitle">
            Registro inmutable de ingresos, ventas, ajustes y stock inicial con responsable y motivo.
          </p>
        </div>
        <button
          type="button"
          className="btn-secundario"
          disabled={loading}
          onClick={handleRefresh}
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <div className="stock-filters-bar">
        <div className="stock-filter-chips" role="group" aria-label="Filtrar por tipo de movimiento">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              className={movementType === option.value ? 'chip activo' : 'chip'}
              onClick={() => {
                if (option.value !== movementType) {
                  setLoading(true);
                  setMovementType(option.value);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form className="admin-search-row" onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className="input-busqueda"
            aria-label="Buscar movimiento por código, producto o motivo"
            placeholder="Buscar por código, medicamento o motivo…"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn-agregar" disabled={loading}>
            Buscar
          </button>
          {appliedQuery && (
            <button
              type="button"
              className="btn-secundario"
              onClick={() => {
                setQuery('');
                setLoading(true);
                setError('');
                setAppliedQuery('');
              }}
            >
              Limpiar
            </button>
          )}
        </form>
      </div>

      {error && (
        <div className="carrito-alerta-error" role="alert">
          {error}
        </div>
      )}

      {loading && movements.length === 0 ? (
        <p className="orders-empty" role="status">Cargando historial de movimientos…</p>
      ) : movements.length === 0 ? (
        <p className="orders-empty">
          No hay movimientos registrados que coincidan con el filtro seleccionado.
        </p>
      ) : (
        <ul className="admin-users-list">
          {movements.map((movement) => {
            const isPositive = movement.quantityDelta > 0;
            return (
              <li key={movement.id} className="admin-user-card">
                <div className="admin-user-header">
                  <div>
                    <span className="stock-code-pill">#{movement.productCode}</span>
                    <strong className="admin-user-email">{movement.productName}</strong>
                    <span className="order-date"> · {formatDateTime(movement.createdAt)}</span>
                  </div>
                  <div className="stock-badges">
                    <span className="admin-role-chip role-pharmacy_operator">
                      {MOVEMENT_TYPE_LABELS[movement.movementType]}
                    </span>
                    <span className={isPositive ? 'movement-delta-pos' : 'movement-delta-neg'}>
                      {isPositive ? `+${movement.quantityDelta}` : movement.quantityDelta}
                    </span>
                  </div>
                </div>

                <p className="stock-description">
                  <strong>Motivo:</strong> {movement.reason}
                </p>

                <div className="movement-meta-row">
                  <span>
                    <strong>Responsable:</strong> {movement.actorEmail ?? movement.actorReference}
                  </span>
                  <span>
                    <strong>Bodega:</strong> {movement.locationName}
                    {movement.lotNumber ? ` · Lote ${movement.lotNumber}` : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
