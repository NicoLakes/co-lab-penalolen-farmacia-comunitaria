import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { listarMedicamentosAdmin } from './admin.api';
import type { MedicamentoAdmin } from './admin.api';
import { evaluarReceta, listarRecetasAdmin, urlArchivoReceta } from './recetas.api';
import type { FiltroReceta, RecetaAdmin } from './recetas.api';
import { ETIQUETAS_RECETA } from '../cuenta/cuenta.api';

interface ItemSeleccionado {
  codigo: string;
  nombre: string;
  cantidad: number;
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

// Revisión de recetas médicas: el funcionario ve el archivo, identifica los
// medicamentos que indica y decide si el vecino puede comprarlos.
export function RecetasPanel() {
  const [filtro, setFiltro] = useState<FiltroReceta>('PENDIENTE');
  const [recetas, setRecetas] = useState<RecetaAdmin[]>([]);
  const [estadoCarga, setEstadoCarga] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [mensaje, setMensaje] = useState('');

  // Catálogo para identificar los medicamentos de la receta.
  const [catalogo, setCatalogo] = useState<MedicamentoAdmin[]>([]);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [items, setItems] = useState<ItemSeleccionado[]>([]);
  const [codigoNuevo, setCodigoNuevo] = useState('');
  const [cantidadNueva, setCantidadNueva] = useState('1');
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorAccion, setErrorAccion] = useState('');

  useEffect(() => {
    let vigente = true;
    listarRecetasAdmin(filtro === 'TODAS' ? undefined : filtro)
      .then((lista) => {
        if (!vigente) return;
        setRecetas(lista);
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
  }, [filtro, intento]);

  useEffect(() => {
    let vigente = true;
    listarMedicamentosAdmin()
      .then((lista) => {
        if (vigente) setCatalogo(lista.filter((med) => med.activo));
      })
      .catch(() => {
        if (vigente) setCatalogo([]);
      });
    return () => {
      vigente = false;
    };
  }, []);

  function abrir(receta: RecetaAdmin) {
    setAbierta(receta.id);
    setZoom(1);
    setItems([]);
    setCodigoNuevo('');
    setCantidadNueva('1');
    setObservaciones('');
    setErrorAccion('');
  }

  function cambiarZoom(delta: number) {
    setZoom((actual) => Math.min(2, Math.max(0.5, Math.round((actual + delta) * 100) / 100)));
  }

  async function recargar() {
    setRecetas(await listarRecetasAdmin(filtro === 'TODAS' ? undefined : filtro));
  }

  function agregarItem(evento: FormEvent) {
    evento.preventDefault();
    const medicamento = catalogo.find((med) => med.codigo === codigoNuevo);
    const cantidad = Number(cantidadNueva);
    if (!medicamento) {
      setErrorAccion('Selecciona un medicamento del catálogo.');
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
      setErrorAccion('La cantidad debe ser un entero entre 1 y 100.');
      return;
    }

    setItems((actuales) => {
      const existente = actuales.find((item) => item.codigo === medicamento.codigo);
      if (existente) {
        return actuales.map((item) =>
          item.codigo === medicamento.codigo
            ? { ...item, cantidad: Math.min(item.cantidad + cantidad, 100) }
            : item,
        );
      }
      return [
        ...actuales,
        {
          codigo: medicamento.codigo,
          nombre: medicamento.principioActivo,
          cantidad,
        },
      ];
    });
    setCodigoNuevo('');
    setCantidadNueva('1');
    setErrorAccion('');
  }

  function cambiarCantidad(codigo: string, valor: string) {
    const cantidad = Number(valor);
    setItems((actuales) =>
      actuales.map((item) =>
        item.codigo === codigo
          ? {
              ...item,
              cantidad: Number.isInteger(cantidad)
                ? Math.min(Math.max(cantidad, 1), 100)
                : item.cantidad,
            }
          : item,
      ),
    );
  }

  async function decidir(receta: RecetaAdmin, estado: 'ACEPTADA' | 'RECHAZADA') {
    if (guardando) return;
    if (estado === 'ACEPTADA' && items.length === 0) {
      setErrorAccion('Agrega al menos un medicamento para aceptar la receta.');
      return;
    }

    setErrorAccion('');
    setGuardando(true);
    try {
      await evaluarReceta(receta.id, {
        estado,
        ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
        ...(estado === 'ACEPTADA'
          ? { items: items.map(({ codigo, cantidad }) => ({ codigo, cantidad })) }
          : {}),
      });
      setMensaje(
        estado === 'ACEPTADA'
          ? `Receta de ${receta.vecino.nombre} aceptada: el vecino ya puede comprar los medicamentos indicados.`
          : `Receta de ${receta.vecino.nombre} rechazada.`,
      );
      setAbierta(null);
      await recargar();
    } catch (e: unknown) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo revisar la receta.');
    } finally {
      setGuardando(false);
    }
  }

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
        <h2>Recetas médicas ({recetas.length})</h2>
        <label className="filtro-estado">
          Filtrar por estado:
          <select
            value={filtro}
            onChange={(e) => {
              setEstadoCarga('cargando');
              setMensaje('');
              setFiltro(e.target.value as FiltroReceta);
            }}
          >
            <option value="PENDIENTE">En revisión</option>
            <option value="ACEPTADA">Aceptadas</option>
            <option value="RECHAZADA">Rechazadas</option>
            <option value="TODAS">Todas</option>
          </select>
        </label>
      </div>

      {mensaje && (
        <p className="cuenta-mensaje" role="status">
          {mensaje}
        </p>
      )}

      {estadoCarga === 'cargando' && (
        <p className="estado-carga" role="status">
          Cargando recetas…
        </p>
      )}

      {estadoCarga === 'listo' && recetas.length === 0 && (
        <p className="sin-resultados">
          {filtro === 'PENDIENTE'
            ? 'No hay recetas pendientes de revisión.'
            : 'No hay recetas con este estado.'}
        </p>
      )}

      {estadoCarga === 'listo' && recetas.length > 0 && (
        <ul className="cola-pedidos">
          {recetas.map((receta) => (
            <li key={receta.id} className="pedido-card receta-admin-card">
              <div className="pedido-cabecera">
                <strong>{receta.vecino.nombre}</strong>
                <span className={`chip-receta receta-${receta.estado.toLowerCase()}`}>
                  {ETIQUETAS_RECETA[receta.estado]}
                </span>
                <span className="pedido-fecha">{fechaHora(receta.creadoEn)}</span>
              </div>

              <p className="pedido-cliente">
                {receta.vecino.email} ·{' '}
                <a
                  href={urlArchivoReceta(receta.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="receta-archivo-enlace"
                >
                  Ver receta ({receta.archivoNombre})
                </a>
              </p>

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

              {receta.estado !== 'PENDIENTE' && (
                <p className="seguimiento-datos">
                  Revisada por {receta.revisadoPor ?? 'funcionario'}
                  {receta.revisadoEn ? ` el ${fechaHora(receta.revisadoEn)}` : ''}
                </p>
              )}

              {receta.estado === 'PENDIENTE' && (
                <div className="pedido-acciones">
                  <button
                    type="button"
                    className="btn-tabla"
                    aria-expanded={abierta === receta.id}
                    onClick={() =>
                      abierta === receta.id ? setAbierta(null) : abrir(receta)
                    }
                  >
                    {abierta === receta.id ? 'Cerrar revisión' : 'Revisar receta'}
                  </button>
                </div>
              )}

              {abierta === receta.id && (
                <div className="receta-revision">
                  <div className="receta-preview">
                    <div className="receta-preview-cabecera">
                      <span>Previsualización de la receta</span>
                      <div className="receta-preview-acciones">
                        <div className="receta-zoom" role="group" aria-label="Zoom de la receta">
                          <button
                            type="button"
                            onClick={() => cambiarZoom(-0.25)}
                            disabled={zoom <= 0.5}
                            aria-label="Alejar"
                            title="Alejar"
                          >
                            −
                          </button>
                          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
                          <button
                            type="button"
                            onClick={() => cambiarZoom(0.25)}
                            disabled={zoom >= 2}
                            aria-label="Acercar"
                            title="Acercar"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => setZoom(1)}
                            disabled={zoom === 1}
                            aria-label="Ajustar al tamaño original"
                            title="Ajustar al tamaño original"
                          >
                            Ajustar
                          </button>
                        </div>
                        <a
                          href={urlArchivoReceta(receta.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="receta-archivo-enlace"
                        >
                          Abrir original
                        </a>
                      </div>
                    </div>
                    <div className="receta-preview-lienzo">
                      {receta.archivoTipo === 'application/pdf' ? (
                        <iframe
                          src={urlArchivoReceta(receta.id)}
                          title={`Receta de ${receta.vecino.nombre}`}
                          style={{ zoom }}
                        />
                      ) : (
                        <img
                          src={urlArchivoReceta(receta.id)}
                          alt={`Receta de ${receta.vecino.nombre}`}
                          style={{ zoom }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="receta-revision-datos">
                  <h3>Medicamentos indicados en la receta</h3>
                  <p className="login-ayuda">
                    Agrega solo los medicamentos que la receta autoriza. El vecino podrá comprar
                    únicamente estos, en la cantidad indicada.
                  </p>

                  {items.length > 0 && (
                    <ul className="receta-items-seleccion">
                      {items.map((item) => (
                        <li key={item.codigo} className="receta-item-fila">
                          <span>{item.nombre}</span>
                          <label>
                            Cantidad
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={item.cantidad}
                              onChange={(e) => cambiarCantidad(item.codigo, e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn-tabla"
                            onClick={() =>
                              setItems((actuales) =>
                                actuales.filter((otro) => otro.codigo !== item.codigo),
                              )
                            }
                          >
                            Quitar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form className="receta-agregar" onSubmit={agregarItem}>
                    <label>
                      Medicamento
                      <select
                        value={codigoNuevo}
                        onChange={(e) => setCodigoNuevo(e.target.value)}
                      >
                        <option value="">Selecciona del catálogo…</option>
                        {catalogo.map((med) => (
                          <option key={med.id} value={med.codigo}>
                            {med.principioActivo} · {med.presentacion} ({med.codigo})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Cantidad
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={cantidadNueva}
                        onChange={(e) => setCantidadNueva(e.target.value)}
                      />
                    </label>
                    <button type="submit" className="btn-admin-primario">
                      Agregar
                    </button>
                  </form>

                  <label htmlFor={`observaciones-${receta.id}`}>
                    Observaciones para el vecino (opcional)
                  </label>
                  <textarea
                    id={`observaciones-${receta.id}`}
                    rows={3}
                    maxLength={500}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Ej: receta válida por 30 días, vigente hasta el 30/11."
                  />

                  {errorAccion && (
                    <p className="checkout-error" role="alert">
                      {errorAccion}
                    </p>
                  )}

                  <div className="receta-revision-acciones">
                    <button
                      type="button"
                      className="btn-admin-primario"
                      disabled={guardando || items.length === 0}
                      onClick={() => decidir(receta, 'ACEPTADA')}
                    >
                      {guardando ? 'Guardando…' : 'Aceptar receta'}
                    </button>
                    <button
                      type="button"
                      className="btn-rechazar"
                      disabled={guardando}
                      onClick={() => decidir(receta, 'RECHAZADA')}
                    >
                      Rechazar receta
                    </button>
                  </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
