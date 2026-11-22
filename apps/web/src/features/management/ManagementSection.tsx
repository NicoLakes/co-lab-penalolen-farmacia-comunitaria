import type { Account } from '../auth/AccountPanel';
import { StockPanel } from './StockPanel';

interface ManagementSectionProps {
  account: Account;
  onBackToCatalog: () => void;
  onCatalogChanged?: () => void;
}

export function ManagementSection({
  account,
  onBackToCatalog,
  onCatalogChanged,
}: ManagementSectionProps) {
  const isStaff = account.roles.includes('pharmacy_operator');

  return (
    <section className="orders-section admin-section" aria-label="Panel de gestión">
      <div className="orders-toolbar">
        <div>
          <h2 className="orders-title">Panel de gestión</h2>
          <p className="orders-subtitle">
            Operación de funcionarios · Sesión: <strong>{account.email}</strong>
          </p>
        </div>
        <div className="orders-toolbar-actions">
          <button type="button" className="btn-agregar" onClick={onBackToCatalog}>
            ← Volver al catálogo
          </button>
        </div>
      </div>

      {isStaff ? (
        <>
          <nav className="admin-tabs" aria-label="Secciones de gestión">
            <button type="button" className="admin-tab activo" aria-current="page">
              Stock
            </button>
          </nav>
          <StockPanel onCatalogChanged={onCatalogChanged} />
        </>
      ) : (
        <p className="orders-empty">
          Tu cuenta no tiene permisos de funcionario para acceder al Panel de gestión.
        </p>
      )}
    </section>
  );
}
