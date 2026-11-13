import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

export interface Account {
  email: string;
  roles: string[];
}

interface AccountPanelProps {
  onAccountChange?: (account: Account | null) => void;
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

export function AccountPanel({ onAccountChange }: AccountPanelProps = {}) {
  const [account, setAccount] = useState<Account | 'disabled' | null>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCodeHint, setDevCodeHint] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readAccount(controller.signal).then((result) => {
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
    if (codeSent) codeInput.current?.focus();
  }, [codeSent]);

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
        setDevCodeHint('');
        setCodeSent(false);
      } else {
        const payload: unknown = await response.json().catch(() => null);
        if (payload && typeof payload === 'object' && 'devCode' in payload && typeof payload.devCode === 'string') {
          setDevCodeHint(payload.devCode);
          setCode(payload.devCode);
        } else {
          setDevCodeHint('');
        }
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
      setDevCodeHint('');
    } catch {
      setError('No pudimos cerrar tu sesión. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  if (account === undefined || account === 'disabled') return null;
  return (
    <details className="account-access">
      <summary className="btn-modo-simple">{account ? `Mi cuenta (${account.email})` : 'Iniciar sesión'}</summary>
      <div className="account-access-panel" aria-busy={busy}>
        {account ? (
          <>
            <p className="account-email">{account.email}</p>
            <p>{account.roles.includes('buyer')
              ? 'Tu cuenta está habilitada para comprar.'
              : 'La farmacia debe habilitar tu cuenta para comprar.'}</p>
            <button type="button" className="btn-agregar" disabled={busy} onClick={() => void signOut()}>
              {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            {codeSent ? (
              <>
                <p role="status">Enviamos un código a <strong>{email}</strong>. Vence en 5 minutos.</p>
                {devCodeHint && (
                  <p role="status" className="dev-code-banner">
                    Modo desarrollo local — Código generado: <strong>{devCodeHint}</strong>
                  </p>
                )}
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
                  setDevCodeHint('');
                  setError('');
                  requestAnimationFrame(() => emailInput.current?.focus());
                }}>Volver al correo</button>
              )}
            </div>
          </form>
        )}
        {error && <p className="account-access-error" role="alert">{error}</p>}
      </div>
    </details>
  );
}
