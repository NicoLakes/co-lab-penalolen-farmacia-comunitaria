import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LogoMuni } from '../../components/LogoMuni';
import { ETIQUETAS_ESTADO } from '../admin/admin.api';
import {
  ETIQUETAS_RECETA,
  TAMANO_MAXIMO_RECETA,
  TIPOS_ARCHIVO_RECETA,
  actualizarVecino,
  cerrarSesionVecino,
  iniciarSesionVecino,
  pedidosDelVecino,
  recetasDelVecino,
  registrarVecino,
  subirReceta,
  vecinoActual,
} from './cuenta.api';
import type { PedidoVecino, Receta, Vecino } from './cuenta.api';
import { vigenciaReceta } from './vigencia';

type PestanaCuenta = 'login' | 'registro';

interface DatosCuenta {
  nombre: string;
  email: string;
  telefono: string;
  direccion: string;
}

interface Mensaje {
  texto: string;
  error: boolean;
}

const DATOS_VACIOS: DatosCuenta = { nombre: '', email: '', telefono: '', direccion: '' };

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

function fechaCorta(fecha: Date): string {
  return fecha.toLocaleDateString('es-CL', { dateStyle: 'medium' });
}

// Cuenta del vecino (HU-03): registro, inicio de sesión y sus pedidos asociados.
export function CuentaPage() {
  const [vecino, setVecino] = useState<Vecino | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'sin-sesion' | 'con-sesion'>('cargando');
  const [pestana, setPestana] = useState<PestanaCuenta>('login');

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [pedidos, setPedidos] = useState<PedidoVecino[]>([]);
  const [estadoPedidos, setEstadoPedidos] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [errorPedidos, setErrorPedidos] = useState('');
  // Número del pedido cuyo estado está abierto en la tarjeta (sin salir de aquí).
  const [pedidoAbierto, setPedidoAbierto] = useState<number | null>(null);

  // Datos de la cuenta, editables desde "Tus datos".
  const [datos, setDatos] = useState<DatosCuenta>(DATOS_VACIOS);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [mensajeDatos, setMensajeDatos] = useState<Mensaje | null>(null);

  // Recetas médicas adjuntadas por el vecino.
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [archivoReceta, setArchivoReceta] = useState<File | null>(null);
  const [subiendoReceta, setSubiendoReceta] = useState(false);
  const [mensajeReceta, setMensajeReceta] = useState<Mensaje | null>(null);

  // Receta opcional durante el registro: se sube al crear la cuenta.
  const [adjuntarRecetaRegistro, setAdjuntarRecetaRegistro] = useState(false);
  const [recetaRegistro, setRecetaRegistro] = useState<File | null>(null);
  const [errorRecetaRegistro, setErrorRecetaRegistro] = useState('');

  function desdeVecino(cuenta: Vecino): DatosCuenta {
    return {
      nombre: cuenta.nombre,
      email: cuenta.email,
      telefono: cuenta.telefono ?? '',
      direccion: cuenta.direccion ?? '',
    };
  }

  async function cargarRecetas(): Promise<Receta[]> {
    const lista = await recetasDelVecino();
    setRecetas(lista);
    return lista;
  }

  // Al abrir comprobamos si hay una sesión vigente y cargamos sus pedidos.
  useEffect(() => {
    let vigente = true;
    vecinoActual()
      .then(async (u) => {
        if (!vigente) return;
        setVecino(u);
        setDatos(desdeVecino(u));
        setEstado('con-sesion');
        try {
          const lista = await pedidosDelVecino();
          if (!vigente) return;
          setPedidos(lista);
          setEstadoPedidos('listo');
        } catch (e: unknown) {
          if (!vigente) return;
          setErrorPedidos(e instanceof Error ? e.message : 'No se pudieron cargar tus pedidos.');
          setEstadoPedidos('error');
        }
        try {
          if (vigente) await cargarRecetas();
        } catch (e: unknown) {
          if (!vigente) return;
          setMensajeReceta({
            texto: e instanceof Error ? e.message : 'No se pudieron cargar tus recetas.',
            error: true,
          });
        }
      })
      .catch(() => {
        if (!vigente) return;
        setEstado('sin-sesion');
      });
    return () => {
      vigente = false;
    };
  }, []);

  function limpiarFormulario() {
    setNombre('');
    setEmail('');
    setTelefono('');
    setDireccion('');
    setPassword('');
    setError('');
    setAdjuntarRecetaRegistro(false);
    setRecetaRegistro(null);
    setErrorRecetaRegistro('');
  }

  // Valida el archivo antes de crear la cuenta para no dejarlo a medias.
  function elegirRecetaRegistro(archivo: File | null) {
    if (!archivo) {
      setRecetaRegistro(null);
      setErrorRecetaRegistro('');
      return;
    }
    if (!TIPOS_ARCHIVO_RECETA.includes(archivo.type)) {
      setRecetaRegistro(null);
      setErrorRecetaRegistro('La receta debe ser un PDF, JPG o PNG.');
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_RECETA) {
      setRecetaRegistro(null);
      setErrorRecetaRegistro('La receta supera el máximo de 4 MB.');
      return;
    }
    setRecetaRegistro(archivo);
    setErrorRecetaRegistro('');
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    if (pestana === 'registro' && adjuntarRecetaRegistro && !recetaRegistro) {
      setErrorRecetaRegistro('Selecciona el archivo de tu receta o desmarca la opción.');
      return;
    }
    setError('');
    setEnviando(true);
    try {
      const esRegistro = pestana === 'registro';
      const recetaPendiente = esRegistro ? recetaRegistro : null;
      const cuenta = esRegistro
        ? await registrarVecino(
            nombre.trim(),
            email.trim(),
            telefono.trim(),
            direccion.trim(),
            password,
          )
        : await iniciarSesionVecino(email.trim(), password);
      setVecino(cuenta);
      setDatos(desdeVecino(cuenta));
      setEstado('con-sesion');
      limpiarFormulario();
      window.dispatchEvent(new Event('sesion-vecino-cambio'));
      setPedidoAbierto(null);
      setMensajeDatos(null);
      setMensajeReceta(null);

      // La cuenta ya existe: si adjuntó una receta, se envía a revisión.
      if (recetaPendiente) {
        try {
          await subirReceta(recetaPendiente);
          setMensajeReceta({
            texto:
              'Cuenta creada y receta enviada. Un funcionario la revisará; cuando la acepte podrás comprar los medicamentos que indique.',
            error: false,
          });
        } catch (e: unknown) {
          setMensajeReceta({
            texto: `Tu cuenta fue creada, pero la receta no se pudo subir: ${
              e instanceof Error ? e.message : 'inténtalo nuevamente'
            } Puedes adjuntarla desde "Mis recetas".`,
            error: true,
          });
        }
      }

      setEstadoPedidos('cargando');
      const lista = await pedidosDelVecino();
      setPedidos(lista);
      setEstadoPedidos('listo');
      try {
        await cargarRecetas();
      } catch {
        setRecetas([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setEnviando(false);
    }
  }

  // Guarda los datos de la cuenta (editables) sin tocar la contraseña.
  async function guardarDatos(evento: FormEvent) {
    evento.preventDefault();
    if (guardandoDatos) return;
    setMensajeDatos(null);
    setGuardandoDatos(true);
    try {
      const cuenta = await actualizarVecino({
        nombre: datos.nombre.trim(),
        email: datos.email.trim(),
        telefono: datos.telefono.trim(),
        direccion: datos.direccion.trim(),
      });
      setVecino(cuenta);
      setDatos(desdeVecino(cuenta));
      window.dispatchEvent(new Event('sesion-vecino-cambio'));
      setMensajeDatos({ texto: 'Datos guardados correctamente.', error: false });
    } catch (e: unknown) {
      setMensajeDatos({
        texto: e instanceof Error ? e.message : 'No se pudieron guardar los datos.',
        error: true,
      });
    } finally {
      setGuardandoDatos(false);
    }
  }

  // Adjunta una receta médica: queda pendiente para el funcionario.
  async function enviarReceta(evento: FormEvent) {
    evento.preventDefault();
    if (subiendoReceta || !archivoReceta) return;
    setMensajeReceta(null);
    setSubiendoReceta(true);
    try {
      await subirReceta(archivoReceta);
      setArchivoReceta(null);
      setMensajeReceta({
        texto: 'Receta enviada. Queda pendiente de revisión por la farmacia.',
        error: false,
      });
      await cargarRecetas();
    } catch (e: unknown) {
      setMensajeReceta({
        texto: e instanceof Error ? e.message : 'No se pudo subir la receta.',
        error: true,
      });
    } finally {
      setSubiendoReceta(false);
    }
  }

  async function salir() {
    await cerrarSesionVecino();
    setVecino(null);
    setPedidos([]);
    setRecetas([]);
    setDatos(DATOS_VACIOS);
    setPedidoAbierto(null);
    setMensajeDatos(null);
    setMensajeReceta(null);
    setArchivoReceta(null);
    setEstado('sin-sesion');
    limpiarFormulario();
    window.dispatchEvent(new Event('sesion-vecino-cambio'));
  }

  return (
    <div className="portal">
      <header className="portal-header">
        <div>
          <LogoMuni />
          <h1>Mi cuenta</h1>
          <p className="subtitulo">
            {estado === 'con-sesion'
              ? 'Aquí ves tus datos y los pedidos asociados a tu cuenta.'
              : 'Crea tu cuenta para asociar tus pedidos y verlos cuando quieras.'}
          </p>
        </div>
        <div className="header-actions">
          <a className="btn-admin" href="#/">
            Volver al catálogo
          </a>
          <a className="btn-admin" href="#/seguimiento">
            Seguir un pedido
          </a>
        </div>
      </header>

      <main className="pagina-contenido">
        {estado === 'cargando' && (
          <p className="estado-carga" role="status">
            Comprobando tu sesión…
          </p>
        )}

        {estado === 'sin-sesion' && (
          <>
            <div className="admin-tabs cuenta-pestanas" role="tablist" aria-label="Acceso">
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'login'}
                className={pestana === 'login' ? 'tab activo' : 'tab'}
                onClick={() => {
                  setPestana('login');
                  setError('');
                }}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'registro'}
                className={pestana === 'registro' ? 'tab activo' : 'tab'}
                onClick={() => {
                  setPestana('registro');
                  setError('');
                }}
              >
                Crear cuenta
              </button>
            </div>

            <form className="login-admin" onSubmit={enviar}>
              <h2>{pestana === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
              <p className="login-ayuda">
                {pestana === 'login'
                  ? 'Entra con el correo con el que hiciste tus pedidos.'
                  : 'Completa tus datos una vez: el checkout los usará para tus compras y podrás editarlos en "Tus datos".'}
              </p>

              {pestana === 'registro' && (
                <>
                  <label htmlFor="cuenta-nombre">Nombre y apellido</label>
                  <input
                    id="cuenta-nombre"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                  />

                  <label htmlFor="cuenta-telefono">Teléfono de contacto</label>
                  <input
                    id="cuenta-telefono"
                    type="tel"
                    required
                    minLength={8}
                    maxLength={20}
                    autoComplete="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Ej: 987654321"
                  />

                  <label htmlFor="cuenta-direccion">Dirección</label>
                  <input
                    id="cuenta-direccion"
                    type="text"
                    required
                    minLength={5}
                    maxLength={200}
                    autoComplete="street-address"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    placeholder="Ej: Av. Siempreviva 742, Peñalolén"
                  />
                </>
              )}

              <label htmlFor="cuenta-email">Correo</label>
              <input
                id="cuenta-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.cl"
              />

              <label htmlFor="cuenta-password">Contraseña</label>
              <input
                id="cuenta-password"
                type="password"
                required
                minLength={pestana === 'registro' ? 6 : 1}
                autoComplete={pestana === 'registro' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={pestana === 'registro' ? 'Mínimo 6 caracteres' : '••••••••'}
              />

              {pestana === 'registro' && (
                <fieldset className="checkout-receta cuenta-receta-registro">
                  <legend>Receta médica (opcional)</legend>
                  <label className="checkout-receta-toggle">
                    <input
                      type="checkbox"
                      checked={adjuntarRecetaRegistro}
                      onChange={(e) => {
                        setAdjuntarRecetaRegistro(e.target.checked);
                        if (!e.target.checked) elegirRecetaRegistro(null);
                        setErrorRecetaRegistro('');
                      }}
                    />
                    Tengo receta médica y quiero adjuntarla ahora
                  </label>

                  {adjuntarRecetaRegistro && (
                    <div className="checkout-receta-panel">
                      <label htmlFor="registro-receta-archivo">
                        Archivo de la receta (PDF, JPG o PNG · máximo 4 MB)
                      </label>
                      <input
                        id="registro-receta-archivo"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={(e) => elegirRecetaRegistro(e.target.files?.[0] ?? null)}
                      />
                      <p className="login-ayuda">
                        Un funcionario la revisará. Cuando la acepte podrás comprar solo los
                        medicamentos que indique.
                      </p>
                      {errorRecetaRegistro && (
                        <p className="checkout-error" role="alert">
                          {errorRecetaRegistro}
                        </p>
                      )}
                    </div>
                  )}
                </fieldset>
              )}

              {error && (
                <p className="checkout-error" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="btn-admin-primario"
                disabled={
                  enviando ||
                  (pestana === 'registro' && adjuntarRecetaRegistro && !recetaRegistro)
                }
              >
                {enviando
                  ? 'Un momento…'
                  : pestana === 'login'
                    ? 'Entrar'
                    : 'Crear mi cuenta'}
              </button>
            </form>
          </>
        )}

        {estado === 'con-sesion' && vecino && (
          <section className="cuenta-pedidos">
            <form className="cuenta-datos" aria-label="Tus datos" onSubmit={guardarDatos}>
              <h3>Tus datos</h3>
              <p className="login-ayuda">
                Son los mismos que usa el checkout: edítalos acá y no los volverás a ingresar.
              </p>

              <div className="cuenta-datos-campos">
                <div>
                  <label htmlFor="datos-nombre">Nombre y apellido</label>
                  <input
                    id="datos-nombre"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={datos.nombre}
                    onChange={(e) => setDatos((d) => ({ ...d, nombre: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="datos-email">Correo</label>
                  <input
                    id="datos-email"
                    type="email"
                    required
                    value={datos.email}
                    onChange={(e) => setDatos((d) => ({ ...d, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="datos-telefono">Teléfono</label>
                  <input
                    id="datos-telefono"
                    type="tel"
                    required
                    minLength={8}
                    maxLength={20}
                    value={datos.telefono}
                    onChange={(e) => setDatos((d) => ({ ...d, telefono: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="datos-direccion">Dirección</label>
                  <input
                    id="datos-direccion"
                    type="text"
                    required
                    minLength={5}
                    maxLength={200}
                    value={datos.direccion}
                    onChange={(e) => setDatos((d) => ({ ...d, direccion: e.target.value }))}
                  />
                </div>
              </div>

              <div className="cuenta-datos-pie">
                <span className="cuenta-dato-estadistica">
                  Pedidos asociados:{' '}
                  <strong>{estadoPedidos === 'cargando' ? '…' : pedidos.length}</strong>
                </span>
                <button type="submit" className="btn-admin-primario" disabled={guardandoDatos}>
                  {guardandoDatos ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>

              {mensajeDatos && (
                <p
                  className={mensajeDatos.error ? 'cuenta-mensaje error' : 'cuenta-mensaje'}
                  role={mensajeDatos.error ? 'alert' : 'status'}
                >
                  {mensajeDatos.texto}
                </p>
              )}
            </form>

            <div className="cuenta-recetas">
              <h3>Mis recetas</h3>
              <p className="login-ayuda">
                La farmacia revisa cada receta; cuando sea aceptada podrás comprar solo los
                medicamentos que el funcionario indique en ella. La receta debe renovarse cada 6
                meses.
              </p>

              {recetas.length === 0 ? (
                <p className="sin-resultados">Todavía no has adjuntado una receta.</p>
              ) : (
                <ul className="receta-lista">
                  {recetas.map((receta) => {
                    const vigencia = vigenciaReceta(receta);
                    return (
                      <li key={receta.id} className="receta-item">
                        <div className="receta-cabecera">
                          <strong>{receta.archivoNombre}</strong>
                          <span
                            className={`chip-receta receta-${receta.estado.toLowerCase()}`}
                          >
                            {ETIQUETAS_RECETA[receta.estado]}
                          </span>
                          <span className="pedido-fecha">{fechaHora(receta.creadoEn)}</span>
                        </div>

                        {vigencia && (
                          <p
                            className={
                              vigencia.vencida
                                ? 'receta-vigencia vencida'
                                : 'receta-vigencia'
                            }
                          >
                            {vigencia.vencida
                              ? `Receta vencida el ${fechaCorta(vigencia.venceEn)}. Sube una nueva para renovarla.`
                              : `Le quedan ${vigencia.texto} de vigencia · vence el ${fechaCorta(vigencia.venceEn)}.`}
                          </p>
                        )}

                        {receta.estado === 'ACEPTADA' && receta.items.length > 0 && (
                          <ul className="receta-items">
                            {receta.items.map((item) => (
                              <li key={item.codigo}>
                                {item.nombre} × {item.cantidad}
                              </li>
                            ))}
                          </ul>
                        )}

                        {receta.observaciones && (
                          <p className="receta-observaciones">{receta.observaciones}</p>
                        )}
                        {receta.revisadoPor && (
                          <p className="seguimiento-datos">
                            Revisada por {receta.revisadoPor}
                            {receta.revisadoEn ? ` el ${fechaHora(receta.revisadoEn)}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <form className="receta-subida" onSubmit={enviarReceta}>
                <label htmlFor="receta-archivo">
                  Adjuntar receta médica (PDF, JPG o PNG · máximo 4 MB)
                </label>
                <input
                  id="receta-archivo"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    setArchivoReceta(e.target.files?.[0] ?? null);
                    setMensajeReceta(null);
                  }}
                />
                <button
                  type="submit"
                  className="btn-admin-primario"
                  disabled={subiendoReceta || !archivoReceta}
                >
                  {subiendoReceta ? 'Subiendo…' : 'Subir receta'}
                </button>
                {mensajeReceta && (
                  <p
                    className={mensajeReceta.error ? 'cuenta-mensaje error' : 'cuenta-mensaje'}
                    role={mensajeReceta.error ? 'alert' : 'status'}
                  >
                    {mensajeReceta.texto}
                  </p>
                )}
              </form>
            </div>

            <div className="admin-barra-sesion">
              <h2>Mis pedidos</h2>
              <button type="button" className="btn-tabla" onClick={salir}>
                Cerrar sesión
              </button>
            </div>

            {estadoPedidos === 'cargando' && (
              <p className="estado-carga" role="status">
                Cargando tus pedidos…
              </p>
            )}

            {estadoPedidos === 'error' && (
              <div className="estado-error" role="alert">
                <p>{errorPedidos}</p>
              </div>
            )}

            {estadoPedidos === 'listo' && pedidos.length === 0 && (
              <p className="sin-resultados">
                Todavía no tienes pedidos asociados a tu cuenta.{' '}
                <a href="#/">Ir al catálogo</a>.
              </p>
            )}

            {estadoPedidos === 'listo' && pedidos.length > 0 && (
              <ul className="cola-pedidos">
                {pedidos.map((pedido) => (
                  <li key={pedido.numero} className="pedido-card">
                    <div className="pedido-cabecera">
                      <strong>Pedido #{pedido.numero}</strong>
                      <span className={`chip estado-${pedido.estado.toLowerCase()}`}>
                        {ETIQUETAS_ESTADO[pedido.estado]}
                      </span>
                      <span className="pedido-modalidad">
                        {pedido.modalidad === 'DELIVERY' ? 'Delivery' : 'Retiro'}
                      </span>
                      <span className="pedido-fecha">{fechaHora(pedido.creadoEn)}</span>
                    </div>
                    <ul className="pedido-items">
                      {pedido.items.map((item) => (
                        <li key={item.codigo}>
                          <span>
                            {item.nombre} × {item.cantidad}
                          </span>
                          <small>${(item.precio * item.cantidad).toLocaleString('es-CL')}</small>
                        </li>
                      ))}
                    </ul>
                    <div className="pedido-acciones">
                      <strong className="pedido-total">
                        ${pedido.total.toLocaleString('es-CL')}
                      </strong>
                      <button
                        type="button"
                        className="btn-tabla"
                        aria-expanded={pedidoAbierto === pedido.numero}
                        onClick={() =>
                          setPedidoAbierto(
                            pedidoAbierto === pedido.numero ? null : pedido.numero,
                          )
                        }
                      >
                        Ver estado
                      </button>
                    </div>

                    {pedidoAbierto === pedido.numero && (
                      <div className="cuenta-estado" aria-live="polite">
                        <div className="pedido-cabecera">
                          <span className={`chip estado-${pedido.estado.toLowerCase()}`}>
                            {ETIQUETAS_ESTADO[pedido.estado]}
                          </span>
                          <span className="pedido-modalidad">
                            {pedido.modalidad === 'DELIVERY'
                              ? 'Delivery a domicilio'
                              : 'Retiro en la farmacia'}
                          </span>
                          <span className="pedido-fecha">
                            Actualizado: {fechaHora(pedido.actualizadoEn)}
                          </span>
                        </div>

                        <p className="seguimiento-datos">
                          Solicitado el {fechaHora(pedido.creadoEn)}
                          {pedido.direccion
                            ? ` · Entrega en ${pedido.direccion}`
                            : ' · Retiro en mostrador'}
                        </p>

                        <div className="seguimiento-historial">
                          <h3>Historial del pedido</h3>
                          {pedido.historial.length > 0 ? (
                            <ol>
                              {pedido.historial.map((entrada) => (
                                <li key={`${entrada.estado}-${entrada.registradoEn}`}>
                                  <span
                                    className={`chip estado-${entrada.estado.toLowerCase()}`}
                                  >
                                    {ETIQUETAS_ESTADO[entrada.estado]}
                                  </span>
                                  <time dateTime={entrada.registradoEn}>
                                    {fechaHora(entrada.registradoEn)}
                                  </time>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="seguimiento-datos">
                              Sin cambios registrados todavía.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
