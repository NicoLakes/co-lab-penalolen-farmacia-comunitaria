import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  actualizarMedicamento,
  crearMedicamento,
  darDeBaja,
  eliminarMedicamento,
  listarMedicamentosAdmin,
  reactivarMedicamento,
} from './admin.api';
import type { DatosMedicamento, MedicamentoAdmin, Rol } from './admin.api';

const DATOS_VACIOS: DatosMedicamento = {
  codigo: '',
  principioActivo: '',
  descriptor: '',
  formaFarmaceutica: 'COMPRIMIDO',
  presentacion: '',
  proveedor: '',
  clasificacionTerapeutica: '',
  precio: 0,
  stock: 0,
  requiereReceta: false,
};

interface Props {
  rol: Rol;
}

// Tabla de catálogo/stock del panel (HU-09): edición rápida y alta/baja.
export function MedicamentosPanel({ rol }: Props) {
  const [medicamentos, setMedicamentos] = useState<MedicamentoAdmin[]>([]);
  const [estadoCarga, setEstadoCarga] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  const [altaAbierta, setAltaAbierta] = useState(false);
  const [datosAlta, setDatosAlta] = useState<DatosMedicamento>(DATOS_VACIOS);
  const [guardando, setGuardando] = useState(false);
  const [errorAlta, setErrorAlta] = useState('');

  // Edición inline de precio/stock sobre un medicamento existente.
  const [editando, setEditando] = useState<string | null>(null);
  const [precioEdicion, setPrecioEdicion] = useState('');
  const [stockEdicion, setStockEdicion] = useState('');
  const [errorEdicion, setErrorEdicion] = useState('');
  const [confirmandoEliminar, setConfirmandoEliminar] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarMedicamentosAdmin()
      .then((lista) => {
        if (!vigente) return;
        setMedicamentos(lista);
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
  }, [intento]);

  function empezarEdicion(med: MedicamentoAdmin) {
    setEditando(med.id);
    setPrecioEdicion(String(med.precio));
    setStockEdicion(String(med.stock));
    setErrorEdicion('');
  }

  async function guardarEdicion(med: MedicamentoAdmin) {
    const precio = Number(precioEdicion);
    const stock = Number(stockEdicion);
    if (!Number.isInteger(precio) || precio < 0 || !Number.isInteger(stock) || stock < 0) {
      setErrorEdicion('Precio y stock deben ser enteros mayores o iguales a 0.');
      return;
    }

    try {
      const actualizado = await actualizarMedicamento(med.id, { precio, stock });
      setMedicamentos((lista) => lista.map((m) => (m.id === actualizado.id ? actualizado : m)));
      setEditando(null);
      setErrorEdicion('');
    } catch (e: unknown) {
      setErrorEdicion(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  async function alternarBaja(med: MedicamentoAdmin) {
    try {
      const resultado = med.activo ? await darDeBaja(med.id) : await reactivarMedicamento(med.id);
      setMedicamentos((lista) => lista.map((m) => (m.id === resultado.id ? resultado : m)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el medicamento.');
    }
  }

  async function confirmarEliminacion(med: MedicamentoAdmin) {
    try {
      await eliminarMedicamento(med.id);
      setMedicamentos((lista) => lista.filter((m) => m.id !== med.id));
      setConfirmandoEliminar(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el medicamento.');
    }
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    if (guardando) return;
    setErrorAlta('');
    setGuardando(true);
    try {
      const creado = await crearMedicamento(datosAlta);
      setMedicamentos((lista) =>
        [...lista, creado].sort((a, b) => a.principioActivo.localeCompare(b.principioActivo)),
      );
      setDatosAlta(DATOS_VACIOS);
      setAltaAbierta(false);
    } catch (e: unknown) {
      setErrorAlta(e instanceof Error ? e.message : 'No se pudo crear el medicamento.');
    } finally {
      setGuardando(false);
    }
  }

  function campoAlta(campo: keyof DatosMedicamento, valor: string | boolean | number) {
    setDatosAlta((actual) => ({ ...actual, [campo]: valor }));
  }

  if (estadoCarga === 'cargando') {
    return <p className="estado-carga" role="status">Cargando catálogo…</p>;
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
        <h2>Catálogo y stock ({medicamentos.length})</h2>
        {rol === 'admin' && (
          <button type="button" className="btn-admin-primario" onClick={() => setAltaAbierta(!altaAbierta)}>
            {altaAbierta ? 'Cancelar alta' : '+ Nuevo medicamento'}
          </button>
        )}
      </div>

      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}

      {altaAbierta && (
        <form className="alta-medicamento" onSubmit={crear}>
          <div className="alta-campos">
            <label>
              Código
              <input
                required
                maxLength={20}
                value={datosAlta.codigo}
                onChange={(e) => campoAlta('codigo', e.target.value)}
              />
            </label>
            <label>
              Principio activo
              <input
                required
                maxLength={200}
                value={datosAlta.principioActivo}
                onChange={(e) => campoAlta('principioActivo', e.target.value)}
              />
            </label>
            <label>
              Descriptor
              <input
                required
                maxLength={200}
                value={datosAlta.descriptor}
                onChange={(e) => campoAlta('descriptor', e.target.value)}
              />
            </label>
            <label>
              Forma farmacéutica
              <input
                required
                maxLength={100}
                value={datosAlta.formaFarmaceutica}
                onChange={(e) => campoAlta('formaFarmaceutica', e.target.value)}
              />
            </label>
            <label>
              Presentación
              <input
                required
                maxLength={100}
                value={datosAlta.presentacion}
                onChange={(e) => campoAlta('presentacion', e.target.value)}
              />
            </label>
            <label>
              Proveedor
              <input
                required
                maxLength={100}
                value={datosAlta.proveedor}
                onChange={(e) => campoAlta('proveedor', e.target.value)}
              />
            </label>
            <label>
              Clasificación terapéutica
              <input
                required
                maxLength={100}
                value={datosAlta.clasificacionTerapeutica}
                onChange={(e) => campoAlta('clasificacionTerapeutica', e.target.value)}
              />
            </label>
            <label>
              Precio ($)
              <input
                type="number"
                required
                min={0}
                value={datosAlta.precio}
                onChange={(e) => campoAlta('precio', Number(e.target.value))}
              />
            </label>
            <label>
              Stock
              <input
                type="number"
                required
                min={0}
                value={datosAlta.stock}
                onChange={(e) => campoAlta('stock', Number(e.target.value))}
              />
            </label>
            <label className="checkbox-receta">
              <input
                type="checkbox"
                checked={datosAlta.requiereReceta}
                onChange={(e) => campoAlta('requiereReceta', e.target.checked)}
              />
              Requiere receta
            </label>
          </div>
          {errorAlta && (
            <p className="checkout-error" role="alert">
              {errorAlta}
            </p>
          )}
          <button type="submit" className="btn-admin-primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear medicamento'}
          </button>
        </form>
      )}

      <div className="tabla-scroll">
        <table className="tabla-admin">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Principio activo</th>
              <th scope="col">Forma farmacéutica</th>
              <th scope="col">Presentación</th>
              <th scope="col">Proveedor</th>
              <th scope="col">Clasificación</th>
              <th scope="col">Receta</th>
              <th scope="col">Precio</th>
              <th scope="col">Stock</th>
              <th scope="col" className="celda-estado">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {medicamentos.map((med) => (
              <tr key={med.id} className={med.activo ? '' : 'fila-inactiva'}>
                <td>{med.codigo}</td>
                <td>
                  <strong>{med.principioActivo}</strong>
                  <br />
                  <small>{med.descriptor}</small>
                </td>
                <td>{med.formaFarmaceutica}</td>
                <td>{med.presentacion}</td>
                <td>{med.proveedor}</td>
                <td>{med.clasificacionTerapeutica}</td>
                <td>
                  <span className={med.requiereReceta ? 'tag-receta obligatoria' : 'tag-receta libre'}>
                    {med.requiereReceta ? 'Requiere receta' : 'Venta directa'}
                  </span>
                </td>
                <td>
                  {editando === med.id ? (
                    <input
                      type="number"
                      min={0}
                      className="celda-input"
                      value={precioEdicion}
                      onChange={(e) => setPrecioEdicion(e.target.value)}
                      aria-label={`Precio de ${med.principioActivo}`}
                    />
                  ) : (
                    `$${med.precio.toLocaleString('es-CL')}`
                  )}
                </td>
                <td>
                  {editando === med.id ? (
                    <input
                      type="number"
                      min={0}
                      className="celda-input"
                      value={stockEdicion}
                      onChange={(e) => setStockEdicion(e.target.value)}
                      aria-label={`Stock de ${med.principioActivo}`}
                    />
                  ) : (
                    med.stock
                  )}
                </td>
                <td className="celda-estado">
                  <span className={med.activo ? 'chip estado-activo' : 'chip estado-inactivo'}>
                    {med.activo ? 'Activo' : 'Dado de baja'}
                  </span>
                </td>
                <td className="celda-acciones">
                  {editando === med.id ? (
                    <>
                      <button
                        type="button"
                        className="btn-tabla"
                        onClick={() => guardarEdicion(med)}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn-tabla"
                        onClick={() => {
                          setEditando(null);
                          setErrorEdicion('');
                        }}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-tabla" onClick={() => empezarEdicion(med)}>
                        Editar precio/stock
                      </button>
                      {rol === 'admin' && (
                        <>
                          <button
                            type="button"
                            className={med.activo ? 'btn-tabla peligro' : 'btn-tabla'}
                            onClick={() => alternarBaja(med)}
                          >
                            {med.activo ? 'Dar de baja' : 'Reactivar'}
                          </button>
                          {!med.activo &&
                            (confirmandoEliminar === med.id ? (
                              <>
                                <small>¿Eliminar definitivamente?</small>
                                <button
                                  type="button"
                                  className="btn-tabla peligro"
                                  onClick={() => confirmarEliminacion(med)}
                                >
                                  Sí, eliminar
                                </button>
                                <button
                                  type="button"
                                  className="btn-tabla"
                                  onClick={() => setConfirmandoEliminar(null)}
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn-tabla peligro"
                                onClick={() => setConfirmandoEliminar(med.id)}
                              >
                                Eliminar
                              </button>
                            ))}
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errorEdicion && (
        <p className="checkout-error" role="alert">
          {errorEdicion}
        </p>
      )}
      {medicamentos.length === 0 && (
        <p className="sin-resultados">No hay medicamentos en el catálogo todavía.</p>
      )}
    </div>
  );
}
