import { useEffect, useState } from 'react';
import { cambiarEstadoPedido, listarPedidos, obtenerPedido } from './admin.api';
import type { EstadoPedido, Pedido } from './admin.api';
import { ESTADOS_PEDIDO, ETIQUETAS_ESTADO } from './admin.api';
import { siguientesSegunModalidad } from './pedidos.modalidad';
import { ordenarPedidos } from './pedidos.orden';
import type { OrdenPedidos } from './pedidos.orden';

function fechaHora(iso: string): string {
  const fecha = new Date(iso);
  return `${fecha.toLocaleDateString('es-CL')} ${fecha.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// Cola de pedidos del panel (HU-10) con cambio de estado e historial (HU-11).
export function PedidosPanel() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [filtro, setFiltro] = useState<EstadoPedido | ''>('');
  const [orden, setOrden] = useState<OrdenPedidos>('recientes');
  const [estadoCarga, setEstadoCarga] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  const [detalle, setDetalle] = useState<Pedido | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorAccion, setErrorAccion] = useState('');

  useEffect(() => {
    let vigente = true;
    listarPedidos(filtro || undefined)
      .then((lista) => {
        if (!vigente) return;
        setPedidos(lista);
        setEstadoCarga('listo');
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        setError(e instanceof Error ? e.message : 'Error desconocido.');
        setEstadoCarga('error');
      });
    return () => {
      vigente = false;
    };
  }, [intento, filtro]);

  async function abrirDetalle(id: string) {
    setCargandoDetalle(true);
    setErrorAccion('');
    try {
      setDetalle(await obtenerPedido(id));
    } catch (e: unknown) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo cargar el pedido.');
      setDetalle(null);
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function mover(pedido: Pedido, estado: EstadoPedido) {
    setErrorAccion('');
    try {
      const actualizado = await cambiarEstadoPedido(pedido.id, estado);
      setPedidos((lista) => lista.map((p) => (p.id === actualizado.id ? actualizado : p)));
      if (detalle?.id === actualizado.id) setDetalle(actualizado);
    } catch (e: unknown) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  if (estadoCarga === 'cargando') {
    return <p className="estado-carga" role="status">Cargando pedidos…</p>;
  }

  // Orden elegido por el funcionario: por defecto los más recientes primero.
  const pedidosOrdenados = ordenarPedidos(pedidos, orden);

  if (estadoCarga === 'error') {
    return (
      <div className="estado-error" role="alert">
        <p>{error}</p>
        <button
          type="button"
          className="btn-reintentar"
          onClick={() => {
            setEstadoCarga('cargando');
            setIntento((n) => n + 1);
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="panel-tabla">
      <div className="panel-barra">
        <h2>Cola de pedidos ({pedidos.length})</h2>
        <div className="panel-controles">
          <label className="filtro-estado">
            Ordenar por:
            <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenPedidos)}>
              <option value="recientes">Más reciente</option>
              <option value="antiguos">Más antiguo</option>
            </select>
          </label>
          <label className="filtro-estado">
            Filtrar por estado:
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoPedido | '')}>
              <option value="">Todos</option>
              {ESTADOS_PEDIDO.map((estado) => (
                <option key={estado} value={estado}>
                  {ETIQUETAS_ESTADO[estado]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {errorAccion && (
        <p className="checkout-error" role="alert">
          {errorAccion}
        </p>
      )}

      {pedidos.length === 0 ? (
        <p className="sin-resultados">No hay pedidos{filtro ? ` en estado "${ETIQUETAS_ESTADO[filtro]}"` : ''}.</p>
      ) : (
        <ul className="cola-pedidos">
          {pedidosOrdenados.map((pedido) => (
            <li key={pedido.id} className="pedido-card">
              <div className="pedido-cabecera">
                <strong>#{pedido.numero}</strong>
                <span className={`chip estado-${pedido.estado.toLowerCase()}`}>
                  {ETIQUETAS_ESTADO[pedido.estado]}
                </span>
                <span className="pedido-modalidad">
                  {pedido.modalidad === 'DELIVERY' ? 'Delivery' : 'Retiro'}
                </span>
                <span className="pedido-fecha">{fechaHora(pedido.creadoEn)}</span>
              </div>

              <p className="pedido-cliente">
                {pedido.clienteNombre} · {pedido.contacto}
                {pedido.direccion ? ` · ${pedido.direccion}` : ''}
              </p>

              <ul className="pedido-items">
                {pedido.items.map((item) => (
                  <li key={item.codigo}>
                    {item.cantidad} × {item.nombre}{' '}
                    <small>${(item.precio * item.cantidad).toLocaleString('es-CL')}</small>
                  </li>
                ))}
              </ul>

              <div className="pedido-acciones">
                <strong className="pedido-total">${pedido.total.toLocaleString('es-CL')}</strong>
                <button
                  type="button"
                  className="btn-tabla"
                  onClick={() => abrirDetalle(pedido.id)}
                  disabled={cargandoDetalle}
                >
                  Ver historial
                </button>
                {siguientesSegunModalidad(pedido.estado, pedido.modalidad).map((siguiente) => (
                  <button
                    key={siguiente}
                    type="button"
                    className={
                      siguiente === 'CANCELADO' ? 'btn-tabla peligro' : 'btn-tabla primario'
                    }
                    onClick={() => mover(pedido, siguiente)}
                  >
                    → {ETIQUETAS_ESTADO[siguiente]}
                  </button>
                ))}
              </div>

              {detalle?.id === pedido.id && (
                <div className="pedido-historial">
                  <h3>Historial del pedido #{pedido.numero}</h3>
                  <ol>
                    {(detalle.historial ?? []).map((entrada, indice) => (
                      <li key={`${entrada.estado}-${indice}`}>
                        <span className={`chip estado-${entrada.estado.toLowerCase()}`}>
                          {ETIQUETAS_ESTADO[entrada.estado]}
                        </span>{' '}
                        {fechaHora(entrada.registradoEn)} — <em>{entrada.responsable}</em>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
