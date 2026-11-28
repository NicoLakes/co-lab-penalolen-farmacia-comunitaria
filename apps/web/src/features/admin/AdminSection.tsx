import { useState } from 'react';
import type { Account } from '../auth/AccountPanel';
import { StockMovementsPanel } from './StockMovementsPanel';
import { UsersPanel } from './UsersPanel';

interface AdminSectionProps {
  account: Account;
  onBackToCatalog: () => void;
}

export function AdminSection({ account, onBackToCatalog }: AdminSectionProps) {
  const isUserAdmin = account.roles.includes('user_admin');
  const [activeTab, setActiveTab] = useState<'users' | 'movements'>('users');

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
            <button
              type="button"
              className={activeTab === 'users' ? 'admin-tab activo' : 'admin-tab'}
              aria-current={activeTab === 'users' ? 'page' : undefined}
              onClick={() => setActiveTab('users')}
            >
              Usuarios
            </button>
            <button
              type="button"
              className={activeTab === 'movements' ? 'admin-tab activo' : 'admin-tab'}
              aria-current={activeTab === 'movements' ? 'page' : undefined}
              onClick={() => setActiveTab('movements')}
            >
              Movimientos de stock
            </button>
          </nav>

          {activeTab === 'users' ? (
            <UsersPanel currentUserEmail={account.email} />
          ) : (
            <StockMovementsPanel />
          )}
        </>
      ) : (
        <p className="orders-empty">
          Tu cuenta no tiene secciones habilitadas en este panel todavía.
        </p>
      )}
    </section>
  );
}
