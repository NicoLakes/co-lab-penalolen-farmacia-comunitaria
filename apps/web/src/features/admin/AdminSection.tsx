import type { Account } from '../auth/AccountPanel';
import { UsersPanel } from './UsersPanel';

interface AdminSectionProps {
  account: Account;
  onBackToCatalog: () => void;
}

export function AdminSection({ account, onBackToCatalog }: AdminSectionProps) {
  const isUserAdmin = account.roles.includes('user_admin');

  return (
    <section className="orders-section admin-section" aria-label="Panel de administración">
      <div className="orders-toolbar">
        <div>
          <h2 className="orders-title">Panel de administración</h2>
          <p className="orders-subtitle">
            Operación interna de la Farmacia Comunitaria · Sesión: <strong>{account.email}</strong>
          </p>
        </div>
        <div className="orders-toolbar-actions">
          <button type="button" className="btn-agregar" onClick={onBackToCatalog}>
            ← Volver al catálogo
          </button>
        </div>
      </div>

      {isUserAdmin ? (
        <>
          <nav className="admin-tabs" aria-label="Secciones del panel">
            <button type="button" className="admin-tab activo" aria-current="page">
              Usuarios
            </button>
          </nav>
          <UsersPanel currentUserEmail={account.email} />
        </>
      ) : (
        <p className="orders-empty">
          Tu cuenta no tiene secciones habilitadas en este panel todavía.
        </p>
      )}
    </section>
  );
}
