import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AdminUsersApiError,
  createManagedUser,
  listManagedUsers,
  setManagedUserRole,
  setManagedUserStatus,
} from './admin-users.api';
import type { ManagedRole, ManagedUser, UserAccountStatus } from './admin-users.api';

interface UsersPanelProps {
  currentUserEmail: string;
}

const ROLE_LABELS: Record<ManagedRole, string> = {
  buyer: 'Vecino (Comprador)',
  pharmacy_operator: 'Funcionario',
  user_admin: 'Administrador',
};

const ALL_ROLES: readonly ManagedRole[] = ['buyer', 'pharmacy_operator', 'user_admin'];

export function UsersPanel({ currentUserEmail }: UsersPanelProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRoles, setNewRoles] = useState<ManagedRole[]>(['buyer']);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void listManagedUsers(appliedQuery, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setUsers(result);
        setError('');
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof AdminUsersApiError
            ? failure.message
            : 'No pudimos cargar los usuarios. Revisa tu conexión e inténtalo de nuevo.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedQuery, refreshTick]);

  function handleRefresh() {
    setLoading(true);
    setError('');
    setRefreshTick((tick) => tick + 1);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage('');
    setLoading(true);
    setError('');
    const nextQuery = query.trim();
    if (nextQuery === appliedQuery) {
      setRefreshTick((tick) => tick + 1);
    } else {
      setAppliedQuery(nextQuery);
    }
  }

  function toggleNewRole(role: ManagedRole) {
    setNewRoles((current) =>
      current.includes(role)
        ? current.filter((existing) => existing !== role)
        : [...current, role],
    );
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError('');
    setStatusMessage('');
    try {
      const created = await createManagedUser(newEmail, newRoles);
      setNewEmail('');
      setNewRoles(['buyer']);
      setUsers((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setStatusMessage(
        `Cuenta ${created.email} creada. Ya puede ingresar desde "Iniciar sesión" usando el código enviado a su correo.`,
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof AdminUsersApiError
          ? failure.message
          : 'No pudimos crear la cuenta. Inténtalo de nuevo.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleToggle(user: ManagedUser, role: ManagedRole) {
    if (busyUserId) return;
    const currentlyHasRole = user.roles.includes(role);
    const grant = !currentlyHasRole;

    setBusyUserId(user.id);
    setError('');
    setStatusMessage('');
    try {
      await setManagedUserRole(user.id, role, grant);
      setUsers((current) =>
        current.map((item) => {
          if (item.id !== user.id) return item;
          const nextRoles = grant
            ? [...item.roles, role].sort()
            : item.roles.filter((existing) => existing !== role);
          return { ...item, roles: nextRoles };
        }),
      );
      setStatusMessage(
        grant
          ? `Se otorgó el rol ${ROLE_LABELS[role]} a ${user.email}.`
          : `Se revocó el rol ${ROLE_LABELS[role]} de ${user.email}.`,
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof AdminUsersApiError
          ? failure.message
          : 'No pudimos actualizar el rol del usuario.',
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleStatusChange(user: ManagedUser, nextStatus: UserAccountStatus) {
    if (busyUserId) return;
    setBusyUserId(user.id);
    setError('');
    setStatusMessage('');
    try {
      await setManagedUserStatus(user.id, nextStatus);
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, status: nextStatus } : item)),
      );
      setConfirmDisableId(null);
      setStatusMessage(
        nextStatus === 'disabled'
          ? `Cuenta ${user.email} deshabilitada y sesiones cerradas.`
          : `Cuenta ${user.email} reactivada.`,
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof AdminUsersApiError
          ? failure.message
          : 'No pudimos cambiar el estado de la cuenta.',
      );
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="admin-panel-content">
      <div className="admin-section-intro">
        <div>
          <h3 className="admin-subheading">Gestión de usuarios y roles</h3>
          <p className="orders-subtitle">
            Crea cuentas con sus roles iniciales, designa funcionarios o administradores, o deshabilita accesos.
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

      <form className="admin-create-card" onSubmit={(event) => void handleCreateSubmit(event)}>
        <h4 className="admin-create-title">Crear nueva cuenta</h4>
        <div className="admin-search-row">
          <input
            id="admin-new-user-email"
            type="email"
            className="input-busqueda"
            aria-label="Correo de la nueva cuenta"
            placeholder="correo@ejemplo.cl"
            maxLength={254}
            required
            disabled={creating}
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
          />
          <button type="submit" className="btn-agregar" disabled={creating}>
            {creating ? 'Creando…' : '+ Crear cuenta'}
          </button>
        </div>
        <div className="admin-create-roles" role="group" aria-label="Roles iniciales">
          {ALL_ROLES.map((role) => (
            <label key={role} className="admin-checkbox-label">
              <input
                type="checkbox"
                checked={newRoles.includes(role)}
                disabled={creating}
                onChange={() => toggleNewRole(role)}
              />
              <span>{ROLE_LABELS[role]}</span>
            </label>
          ))}
        </div>
      </form>

      <form className="admin-search-form" onSubmit={handleSearchSubmit}>
        <label htmlFor="admin-user-search" className="admin-search-label">
          Buscar por correo electrónico
        </label>
        <div className="admin-search-row">
          <input
            id="admin-user-search"
            type="search"
            className="input-busqueda"
            placeholder="Ej: vecino@gmail.com"
            maxLength={254}
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
                setStatusMessage('');
              }}
            >
              Limpiar
            </button>
          )}
        </div>
      </form>

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

      {loading && users.length === 0 ? (
        <p className="orders-empty" role="status">Cargando usuarios…</p>
      ) : users.length === 0 ? (
        <p className="orders-empty">
          {appliedQuery
            ? `No encontramos cuentas que coincidan con "${appliedQuery}".`
            : 'Aún no hay cuentas registradas.'}
        </p>
      ) : (
        <ul className="admin-users-list">
          {users.map((user) => {
            const isSelf = user.email.toLowerCase() === currentUserEmail.toLowerCase();
            const isAdminAccount = user.roles.includes('user_admin');
            const isBusy = busyUserId === user.id;
            const isDisabled = user.status === 'disabled';
            const canEditRoles = !isSelf;
            const canEditStatus = !isSelf && !isAdminAccount;
            const confirmingDisable = confirmDisableId === user.id;

            return (
              <li key={user.id} className="admin-user-card">
                <div className="admin-user-header">
                  <div>
                    <strong className="admin-user-email">{user.email}</strong>
                    {isSelf && <span className="admin-self-tag">Tu cuenta</span>}
                  </div>
                  <span
                    className={
                      isDisabled
                        ? 'order-status-badge status-cancelled'
                        : 'order-status-badge status-fulfilled'
                    }
                  >
                    {isDisabled ? 'Deshabilitada' : 'Activa'}
                  </span>
                </div>

                <div className="admin-user-roles">
                  {user.roles.length === 0 ? (
                    <span className="admin-role-chip role-none">Sin roles asignados</span>
                  ) : (
                    user.roles.map((role) => (
                      <span key={role} className={`admin-role-chip role-${role}`}>
                        {ROLE_LABELS[role]}
                      </span>
                    ))
                  )}
                </div>

                <div className="admin-user-actions">
                  {canEditRoles ? (
                    <>
                      {ALL_ROLES.map((role) => {
                        const hasRole = user.roles.includes(role);
                        if (role === 'user_admin' && hasRole) return null;
                        return (
                          <button
                            key={role}
                            type="button"
                            className={hasRole ? 'btn-secundario' : 'btn-agregar'}
                            disabled={isBusy || (!hasRole && isDisabled)}
                            onClick={() => void handleRoleToggle(user, role)}
                          >
                            {hasRole ? `Quitar ${ROLE_LABELS[role]}` : `+ ${ROLE_LABELS[role]}`}
                          </button>
                        );
                      })}
                      {canEditStatus ? (
                        isDisabled ? (
                          <button
                            type="button"
                            className="btn-secundario"
                            disabled={isBusy}
                            onClick={() => void handleStatusChange(user, 'active')}
                          >
                            Reactivar cuenta
                          </button>
                        ) : !confirmingDisable ? (
                          <button
                            type="button"
                            className="btn-peligro-suave"
                            disabled={isBusy}
                            onClick={() => setConfirmDisableId(user.id)}
                          >
                            Deshabilitar cuenta
                          </button>
                        ) : null
                      ) : (
                        <span className="admin-lock-note">
                          Las cuentas administradoras solo se revocan desde consola (CLI).
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="admin-lock-note">
                      Por seguridad, no puedes modificar los roles ni el estado de tu propia cuenta.
                    </span>
                  )}
                </div>

                {confirmingDisable && (
                  <div className="order-cancel-confirm" role="region" aria-label="Confirmar deshabilitación">
                    <p>
                      ¿Deshabilitar a <strong>{user.email}</strong>? Se cerrarán sus sesiones activas y no podrá volver a iniciar sesión hasta reactivarla.
                    </p>
                    <div className="order-cancel-confirm-actions">
                      <button
                        type="button"
                        className="btn-peligro"
                        disabled={isBusy}
                        onClick={() => void handleStatusChange(user, 'disabled')}
                      >
                        {isBusy ? 'Deshabilitando…' : 'Sí, deshabilitar'}
                      </button>
                      <button
                        type="button"
                        className="btn-secundario"
                        disabled={isBusy}
                        onClick={() => setConfirmDisableId(null)}
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
