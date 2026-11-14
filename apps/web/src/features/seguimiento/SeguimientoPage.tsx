import { useState } from 'react';
import type { FormEvent } from 'react';
import { LogoMuni } from '../../components/LogoMuni';
import { BotonCuenta } from '../../components/BotonCuenta';
import { ETIQUETAS_ESTADO } from '../admin/admin.api';
import { consultarPedido } from './seguimiento.api';
import type { PedidoSeguimiento } from './seguimiento.api';

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

function numeroDesdeRuta(): string {
  const coincidencia = window.location.hash.match(/[?&]numero=(\d+)/);
  return coincidencia?.[1] ?? '';
}

// Consulta pública del estado de un pedido (HU-07): sin cuenta, solo número + contacto.
export function SeguimientoPage() {
  const [numero, setNumero] = useState(numeroDesdeRuta);
  const [contacto, setContacto] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [error, setError] = useState('');
  const [pedido, setPedido] = useState<PedidoSeguimiento | null>(null);

  async function consultar(evento: FormEvent) {
    evento.preventDefault();
    if (consultando) return;
    setError('');
    setConsultando(true);
    try {
      const resultado = await consultarPedido(Number(numero), contacto.trim());
      setPedido(resultado);
    } catch (e: unknown) {
      setPedido(null);
      setError(e instanceof Error ? e.message : 'No se pudo consultar el pedido.');
    } finally {
      setConsultando(false);
    }
  }

  return (
    <div className="portal">
      <header className="portal-header">
        <div>
          <LogoMuni />
          <h1>Seguimiento de pedido</h1>
          <p className="subtitulo">
            Ingresa el número de pedido y el contacto con el que lo solicitaste.
          </p>
        </div>
        <div className="header-actions">
          <a className="btn-admin" href="#/">
            Volver al catálogo
          </a>
          <BotonCuenta />
        </div>
      </header>

      <main className="pagina-contenido">
        <form className="login-admin" onSubmit={consultar}>
          <h2>Consultar estado</h2>
          <p className="login-ayuda">
            Te mostramos la etapa actual, la fecha y la modalidad de entrega.
          </p>

          <label htmlFor="seguimiento-numero">Número de pedido</label>
          <input
            id="seguimiento-numero"
            type="number"
            min={1}
            required
            inputMode="numeric"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Ej: 12"
          />

          <label htmlFor="seguimiento-contacto">Correo o teléfono de contacto</label>
          <input
            id="seguimiento-contacto"
            type="text"
            required
            minLength={3}
            maxLength={160}
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            placeholder="El mismo que usaste al pedir"
          />

          {error && (
            <p className="checkout-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-admin-primario" disabled={consultando}>
            {consultando ? 'Consultando…' : 'Ver estado'}
          </button>
        </form>

        {pedido && (
          <section className="seguimiento-resultado" aria-live="polite">
            <div className="pedido-cabecera">
              <h2>Pedido #{pedido.numero}</h2>
              <span className={`chip estado-${pedido.estado.toLowerCase()}`}>
                {ETIQUETAS_ESTADO[pedido.estado]}
              </span>
              <span className="pedido-modalidad">
                {pedido.modalidad === 'DELIVERY' ? 'Delivery a domicilio' : 'Retiro en la farmacia'}
              </span>
              <span className="pedido-fecha">Actualizado: {fechaHora(pedido.actualizadoEn)}</span>
            </div>

            <p className="seguimiento-datos">
              Solicitado el {fechaHora(pedido.creadoEn)}
              {pedido.direccion ? ` · Entrega en ${pedido.direccion}` : ' · Retiro en mostrador'}
            </p>

            <div className="seguimiento-historial">
              <h3>Historial del pedido</h3>
              <ol>
                {pedido.historial.map((entrada) => (
                  <li key={`${entrada.estado}-${entrada.registradoEn}`}>
                    <span className={`chip estado-${entrada.estado.toLowerCase()}`}>
                      {ETIQUETAS_ESTADO[entrada.estado]}
                    </span>
                    <time dateTime={entrada.registradoEn}>{fechaHora(entrada.registradoEn)}</time>
                  </li>
                ))}
              </ol>
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
            <p className="pedido-total-seguimiento">
              Total: <strong>${pedido.total.toLocaleString('es-CL')}</strong>
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
