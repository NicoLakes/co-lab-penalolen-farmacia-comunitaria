import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LogoMuni } from '../../components/LogoMuni';
import { cerrarSesion, iniciarSesion, usuarioActual } from './admin.api';
import type { Usuario } from './admin.api';
import { MedicamentosPanel } from './MedicamentosPanel';
import { PedidosPanel } from './PedidosPanel';
import { RecetasPanel } from './RecetasPanel';

type Pestana = 'catalogo' | 'pedidos' | 'recetas';

// Panel de funcionarios: login simple con sesión y gestión de catálogo/pedidos.
export function AdminPage() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [estadoSesion, setEstadoSesion] = useState<'cargando' | 'sin-sesion' | 'con-sesion'>(
    'cargando',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorLogin, setErrorLogin] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [pestana, setPestana] = useState<Pestana>('catalogo');

  // Al abrir el panel comprobamos si ya hay una sesión vigente en la cookie.
  useEffect(() => {
    let vigente = true;
    usuarioActual()
      .then((u) => {
        if (!vigente) return;
        setUsuario(u);
        setEstadoSesion('con-sesion');
      })
      .catch(() => {
        if (!vigente) return;
        setEstadoSesion('sin-sesion');
      });
    return () => {
      vigente = false;
    };
  }, []);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    if (entrando) return;
    setErrorLogin('');
    setEntrando(true);
    try {
      const u = await iniciarSesion(email.trim(), password);
      setUsuario(u);
      setEstadoSesion('con-sesion');
      setPassword('');
    } catch (e: unknown) {
      setErrorLogin(e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
    } finally {
      setEntrando(false);
    }
  }

  async function salir() {
    await cerrarSesion();
    setUsuario(null);
    setEstadoSesion('sin-sesion');
    setEmail('');
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-marca">
          <LogoMuni />
          <div>
            <h1>Panel de la Farmacia Comunitaria</h1>
            <p>Gestión de catálogo, stock y pedidos</p>
          </div>
        </div>
        <a className="btn-admin" href="#/">
          Ver catálogo del vecino
        </a>
      </header>

      {estadoSesion === 'cargando' && (
        <p className="estado-carga" role="status">
          Comprobando sesión…
        </p>
      )}

      {estadoSesion === 'sin-sesion' && (
        <form className="login-admin" onSubmit={entrar}>
          <h2>Iniciar sesión</h2>
          <p className="login-ayuda">Acceso para funcionarios y administración de la farmacia.</p>

          <label htmlFor="login-email">Correo</label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@farmacia.local"
          />

          <label htmlFor="login-password">Contraseña</label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          {errorLogin && (
            <p className="checkout-error" role="alert">
              {errorLogin}
            </p>
          )}

          <button type="submit" className="btn-admin-primario" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      )}

      {estadoSesion === 'con-sesion' && usuario && (
        <main className="admin-main">
          <div className="admin-barra-sesion">
            <div className="admin-tabs" role="tablist" aria-label="Secciones del panel">
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'catalogo'}
                className={pestana === 'catalogo' ? 'tab activo' : 'tab'}
                onClick={() => setPestana('catalogo')}
              >
                Catálogo / Stock
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'pedidos'}
                className={pestana === 'pedidos' ? 'tab activo' : 'tab'}
                onClick={() => setPestana('pedidos')}
              >
                Pedidos
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'recetas'}
                className={pestana === 'recetas' ? 'tab activo' : 'tab'}
                onClick={() => setPestana('recetas')}
              >
                Recetas
              </button>
            </div>
            <div className="admin-usuario">
              <span>
                {usuario.nombre} · <strong>{usuario.rol === 'admin' ? 'Administrador' : 'Funcionario'}</strong>
              </span>
              <button type="button" className="btn-tabla" onClick={salir}>
                Cerrar sesión
              </button>
            </div>
          </div>

          <section role="tabpanel">
            {pestana === 'catalogo' && <MedicamentosPanel rol={usuario.rol} />}
            {pestana === 'pedidos' && <PedidosPanel />}
            {pestana === 'recetas' && <RecetasPanel />}
          </section>
        </main>
      )}
    </div>
  );
}
