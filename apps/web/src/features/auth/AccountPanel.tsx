import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

export interface Account {
  email: string;
  roles: string[];
}

interface AccountPanelProps {
  onAccountChange?: (account: Account | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenOrders?: () => void;
  onOpenAdmin?: (() => void) | undefined;
  onOpenManagement?: (() => void) | undefined;
}

async function readAccount(signal?: AbortSignal): Promise<Account | 'disabled' | null> {
  const response = await fetch('/api/me', signal ? { signal } : undefined);
  if (response.status === 404) return 'disabled';
  if (response.status === 401) return null;
  if (response.status === 403) throw new Error('Tu cuenta está deshabilitada. Contacta a la farmacia.');
  if (!response.ok) throw new Error('No pudimos comprobar tu sesión.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('email' in data) || typeof data.email !== 'string'
    || !('roles' in data) || !Array.isArray(data.roles) || !data.roles.every((role) => typeof role === 'string')) {
    throw new Error('No pudimos comprobar tu sesión.');
  }
  return { email: data.email, roles: data.roles };
}

function authRequest(path: string, body: object) {
  return fetch(`/api/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export function AccountPanel({
  onAccountChange,
  open: controlledOpen,
  onOpenChange,
  onOpenOrders,
  onOpenAdmin,
  onOpenManagement,
}: AccountPanelProps = {}) {
  const [account, setAccount] = useState<Account | 'disabled' | null>();
  const [internalOpen, setInternalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    const controller = new AbortController();
    void readAccount(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setAccount(result);
      onAccountChange?.(result && result !== 'disabled' ? result : null);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setAccount(null);
      onAccountChange?.(null);
      setError(failure instanceof Error ? failure.message : 'No pudimos comprobar tu sesión.');
    });
    return () => controller.abort();
  }, [onAccountChange]);

  useEffect(() => {
    if (!isOpen) return;
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const frame = requestAnimationFrame(() => {
      (codeInput.current ?? emailInput.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, codeSent]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, setOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = codeSent
        ? await authRequest('sign-in/email-otp', { email, otp: code })
        : await authRequest('email-otp/send-verification-otp', { email, type: 'sign-in' });
      if (response.status === 429) {
        setError('Hay demasiados intentos. Espera un momento y vuelve a intentarlo.');
      } else if (codeSent && response.status === 403) {
        setError('Tu cuenta está deshabilitada. Contacta a la farmacia.');
      } else if (!response.ok) {
        setError(codeSent
          ? 'No pudimos iniciar sesión. Revisa el código o solicita uno nuevo.'
          : 'No pudimos enviar el código. Inténtalo de nuevo.');
      } else if (codeSent) {
        const session = await readAccount();
        if (!session || session === 'disabled') throw new Error('No pudimos iniciar sesión. Inténtalo de nuevo.');
        setAccount(session);
        onAccountChange?.(session);
        setCode('');
        setCodeSent(false);
        setOpen(false);
      } else {
        setCodeSent(true);
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message.includes('deshabilitada')
        ? failure.message : 'No pudimos completar el acceso. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      if (!(await authRequest('sign-out', {})).ok) throw new Error();
      setAccount(null);
      onAccountChange?.(null);
      setEmail('');
      setOpen(false);
    } catch {
      setError('No pudimos cerrar tu sesión. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  if (account === undefined || account === 'disabled') return null;

  return (
    <div ref={containerRef} className="account-access">
      <button
        type="button"
        className={isOpen ? 'btn-modo-simple activo' : 'btn-modo-simple'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setOpen(!isOpen)}
      >
        {account ? 'Mi cuenta' : 'Iniciar sesión'}
      </button>

      {isOpen && (
        <div
          className="account-access-panel"
          role="dialog"
          aria-label={account ? 'Menú de mi cuenta' : 'Iniciar sesión'}
          aria-busy={busy}
        >
          {account ? (
            <div className="account-menu-body">
              <p className="account-email-label">Sesión iniciada como</p>
              <p className="account-email">{account.email}</p>
              <div className="account-menu-actions">
                {onOpenAdmin && (
                  <button
                    type="button"
                    className="btn-agregar btn-account-full"
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      onOpenAdmin();
                    }}
                  >
                    Panel de administración
                  </button>
                )}
                {onOpenManagement && (
                  <button
                    type="button"
                    className={onOpenAdmin ? 'btn-secundario btn-account-full' : 'btn-agregar btn-account-full'}
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      onOpenManagement();
                    }}
                  >
                    Panel de gestión
                  </button>
                )}
                {onOpenOrders && account.roles.includes('buyer') && (
                  <button
                    type="button"
                    className={onOpenAdmin || onOpenManagement ? 'btn-secundario btn-account-full' : 'btn-agregar btn-account-full'}
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      onOpenOrders();
                    }}
                  >
                    Mis pedidos
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secundario btn-account-full"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              {codeSent ? (
                <>
                  <p role="status">Enviamos un código a <strong>{email}</strong>. Vence en 5 minutos.</p>
                  <label htmlFor="account-code">Código de acceso</label>
                  <input id="account-code" ref={codeInput} className="input-busqueda" type="text"
                    autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                    required disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} />
                </>
              ) : (
                <>
                  <label htmlFor="account-email">Correo electrónico</label>
                  <input id="account-email" ref={emailInput} className="input-busqueda" type="email"
                    autoComplete="email" maxLength={254} required disabled={busy} value={email}
                    onChange={(event) => setEmail(event.target.value)} />
                </>
              )}
              <div className="account-access-actions">
                <button type="submit" className="btn-agregar" disabled={busy}>
                  {codeSent ? (busy ? 'Verificando…' : 'Ingresar') : (busy ? 'Enviando…' : 'Enviar código')}
                </button>
                {codeSent && (
                  <button type="button" className="account-access-secondary" disabled={busy} onClick={() => {
                    setCodeSent(false);
                    setCode('');
                    setError('');
                    requestAnimationFrame(() => emailInput.current?.focus());
                  }}>Volver al correo</button>
                )}
              </div>
            </form>
          )}
          {error && <p className="account-access-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
