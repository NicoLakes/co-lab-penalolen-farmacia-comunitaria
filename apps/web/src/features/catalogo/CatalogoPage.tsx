import { useEffect, useState } from 'react';
import { LogoMuni } from '../../components/LogoMuni';
import { BotonCuenta } from '../../components/BotonCuenta';
import { listarMedicamentos } from './medicamentos.api';
import type { Medicamento } from './medicamentos.api';
import { CarritoPanel } from './CarritoPanel';
import type { ItemCarrito } from './CarritoPanel';
import { recetasDelVecino, vecinoActual } from '../cuenta/cuenta.api';
import { recetaVigente } from '../cuenta/vigencia';

const CLAVE_CARRITO = 'farmacia_carrito';

// El checkout puede pedir iniciar sesión; guardar el carrito evita perderlo
// al volver desde la página de la cuenta.
function carritoGuardado(): ItemCarrito[] {
  try {
    const crudo = sessionStorage.getItem(CLAVE_CARRITO);
    if (!crudo) return [];
    const datos: unknown = JSON.parse(crudo);
    if (!Array.isArray(datos)) return [];
    return datos.filter((item): item is ItemCarrito => {
      if (typeof item !== 'object' || item === null) return false;
      const { medicamento, cantidad } = item as Partial<ItemCarrito>;
      return (
        typeof cantidad === 'number' &&
        cantidad > 0 &&
        typeof medicamento === 'object' &&
        medicamento !== null &&
        typeof medicamento.codigo === 'string' &&
        typeof medicamento.precio === 'number'
      );
    });
  } catch {
    return [];
  }
}

export function CatalogoPage() {
  // 1. Estados: memoria que hace interactiva la página
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('TODAS');
  const [modoSimple, setModoSimple] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>(carritoGuardado);
  const [carritoAbierto, setCarritoAbierto] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
    } catch {
      // Si el navegador bloquea el almacenamiento, el carrito sigue en memoria.
    }
  }, [carrito]);

  // Catálogo desde la API: carga, error y vacío accesibles para el vecino.
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);
  const [estadoCarga, setEstadoCarga] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [errorCarga, setErrorCarga] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    listarMedicamentos()
      .then((lista) => {
        if (!vigente) return;
        setMedicamentos(lista);
        setEstadoCarga('listo');
      })
      .catch((error: unknown) => {
        if (!vigente) return;
        setErrorCarga(error instanceof Error ? error.message : 'Error desconocido.');
        setEstadoCarga('error');
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  // Unidades autorizadas por las recetas aceptadas de la cuenta con sesión.
  const [autorizadosReceta, setAutorizadosReceta] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let vigente = true;
    vecinoActual()
      .then(() => recetasDelVecino())
      .then((lista) => {
        if (!vigente) return;
        const autorizados = new Map<string, number>();
        for (const receta of lista) {
          if (!recetaVigente(receta)) continue;
          for (const item of receta.items) {
            autorizados.set(item.codigo, (autorizados.get(item.codigo) ?? 0) + item.cantidad);
          }
        }
        setAutorizadosReceta(autorizados);
      })
      .catch(() => {
        // Sin sesión activa no se etiqueta ningún medicamento.
      });
    return () => {
      vigente = false;
    };
  }, []);

  function agregarAlCarrito(med: Medicamento) {
    setCarrito((carritoActual) => {
      const existe = carritoActual.find((item) => item.medicamento.codigo === med.codigo);
      if (existe) {
        return carritoActual.map((item) =>
          item.medicamento.codigo === med.codigo
            ? { ...item, cantidad: Math.min(item.cantidad + 1, med.stock) }
            : item,
        );
      }
      return [...carritoActual, { medicamento: med, cantidad: 1 }];
    });
    setCarritoAbierto(true);
  }

  function cambiarCantidad(codigo: string, nuevaCantidad: number) {
    if (nuevaCantidad <= 0) {
      setCarrito((carritoActual) =>
        carritoActual.filter((item) => item.medicamento.codigo !== codigo),
      );
      return;
    }
    setCarrito((carritoActual) =>
      carritoActual.map((item) =>
        item.medicamento.codigo === codigo
          ? { ...item, cantidad: Math.min(nuevaCantidad, item.medicamento.stock) }
          : item,
      ),
    );
  }

  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const totalPrecio = carrito.reduce(
    (acc, item) => acc + item.medicamento.precio * item.cantidad,
    0,
  );

  // 2. Categorías terapéuticas para el filtro (según lo que haya cargado la API)
  const categorias = [
    'TODAS',
    ...Array.from(new Set(medicamentos.map((m) => m.clasificacionTerapeutica))),
  ];

  // 3. Filtramos los medicamentos según lo que escribió el vecino y la categoría elegida
  const medicamentosFiltrados = medicamentos.filter((med: Medicamento) => {
    const texto = busqueda.toLowerCase();
    const coincideTexto =
      med.principioActivo.toLowerCase().includes(texto) ||
      med.descriptor.toLowerCase().includes(texto) ||
      med.codigo.includes(texto);
    const coincideCategoria =
      categoriaActiva === 'TODAS' || med.clasificacionTerapeutica === categoriaActiva;
    return coincideTexto && coincideCategoria;
  });

  // 4. Return que construye la página del cliente con las funciones creadas anteriormente
  return (
    <div className={modoSimple ? 'portal modo-simple' : 'portal'}>
      {/* Encabezado de la Farmacia */}
      <header className="portal-header">
        <div>
          <LogoMuni />
          <h1>Farmacia Comunitaria</h1>
          <p className="subtitulo">
            {modoSimple
              ? 'Paso 1: Escriba el nombre de su remedio abajo para buscarlo.'
              : 'Consulta disponibilidad, precios solidarios y solicita tus medicamentos en línea.'}
          </p>
        </div>
        {/* Acciones del encabezado: Modo Simple y acceso al panel */}
        <div className="header-actions">
          <button
            type="button"
            className={modoSimple ? 'btn-modo-simple activo' : 'btn-modo-simple'}
            onClick={() => setModoSimple(!modoSimple)}
          >
            {modoSimple ? 'Modo Simple Activado (Ver vista estándar)' : 'Activar Modo Simple (Letra Grande)'}
          </button>
          <a className="btn-admin" href="#/seguimiento">
            Seguir mi pedido
          </a>
          <BotonCuenta />
          <a className="btn-admin" href="#/admin">
            Panel de funcionarios
          </a>
        </div>
      </header>

      {/* Barra de Búsqueda */}
      <section className="buscador-section" aria-label="Buscador de medicamentos">
        <label htmlFor="input-busqueda" className="label-busqueda">
          Buscar por Principio Activo o Nombre del medicamento:
        </label>
        <input
          id="input-busqueda"
          type="search"
          className="input-busqueda"
          placeholder="Ej: Acido Valproico, Atemperator, Acenocumarol, Alcohol..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {/* En Modo Simple ocultamos filtros secundarios para no confundir al adulto mayor */}
        {!modoSimple && (
          <div className="filtros-categorias">
            {categorias.map((cat) => (
              <button
                key={cat}
                type="button"
                className={categoriaActiva === cat ? 'chip activo' : 'chip'}
                onClick={() => setCategoriaActiva(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Grilla de Medicamentos */}
      <section className="grilla-medicamentos" aria-busy={estadoCarga === 'cargando'}>
        {estadoCarga === 'cargando' && (
          <p className="estado-carga" role="status">
            Cargando el catálogo de medicamentos…
          </p>
        )}

        {estadoCarga === 'error' && (
          <div className="estado-error" role="alert">
            <p>{errorCarga}</p>
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
        )}

        {estadoCarga === 'listo' && medicamentos.length === 0 && (
          <p className="sin-resultados" role="status">
            Aún no hay medicamentos disponibles en el catálogo.
          </p>
        )}

        {estadoCarga === 'listo' &&
          medicamentos.length > 0 &&
          medicamentosFiltrados.map((med) => (
          <article key={med.codigo} className="card-medicamento">
            <div className="card-top">
              <span className="tag-categoria">{med.clasificacionTerapeutica}</span>
              <span className={med.requiereReceta ? 'tag-receta obligatoria' : 'tag-receta libre'}>
                {med.requiereReceta ? 'Requiere Receta Médica' : 'Venta directa'}
              </span>
            </div>
            {autorizadosReceta.has(med.codigo) && (
              <p className="med-receta-indicada">
                <span className="tag-receta indicada">Indicado en tu receta</span>{' '}
                hasta {autorizadosReceta.get(med.codigo)}{' '}
                {autorizadosReceta.get(med.codigo) === 1 ? 'unidad' : 'unidades'}
              </p>
            )}
            <h2 className="med-titulo">{med.principioActivo}</h2>
            <p className="med-descriptor">{med.descriptor}</p>
            {/* En Modo Simple mostramos solo lo esencial; en modo normal el detalle técnico */}
            {!modoSimple && (
              <p className="med-meta">
                <strong>Presentación:</strong> {med.presentacion} · <strong>Lab:</strong> {med.proveedor}
              </p>
            )}
            <div className="card-footer">
              <div>
                <span className="med-precio">${med.precio.toLocaleString('es-CL')}</span>
                <span className="med-stock">Stock: {med.stock} disp.</span>
              </div>
              <button
                type="button"
                className="btn-agregar"
                onClick={() => agregarAlCarrito(med)}
              >
                + Agregar al carrito
              </button>
            </div>
          </article>
        ))}
        {estadoCarga === 'listo' &&
          medicamentos.length > 0 &&
          medicamentosFiltrados.length === 0 && (
            <p className="sin-resultados">
              No encontramos medicamentos con "{busqueda}". Intente con otro nombre.
            </p>
          )}
      </section>

      {/* Botón circular flotante del carrito en la parte inferior derecha */}
      <button
        type="button"
        className={carritoAbierto ? 'btn-carrito-flotante oculto' : 'btn-carrito-flotante'}
        onClick={() => setCarritoAbierto(!carritoAbierto)}
        aria-label={`Abrir carrito de compras (${totalUnidades} productos, total $${totalPrecio.toLocaleString('es-CL')})`}
        aria-expanded={carritoAbierto}
        title={`Mi Carrito (${totalUnidades}) - $${totalPrecio.toLocaleString('es-CL')}`}
      >
        <svg
          className="icono-carrito"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9" cy="21" r="1.5" />
          <circle cx="19" cy="21" r="1.5" />
          <path d="M2.5 3h2.8l2.4 11.4a2 2 0 0 0 2 1.6h9.6a2 2 0 0 0 1.9-1.5L23 6H6.2" />
        </svg>
        {totalUnidades > 0 && (
          <span className="carrito-badge" aria-hidden="true">
            {totalUnidades}
          </span>
        )}
      </button>

      <CarritoPanel
        carrito={carrito}
        abierto={carritoAbierto}
        onCerrar={() => setCarritoAbierto(false)}
        onCambiarCantidad={cambiarCantidad}
        onPedidoConfirmado={() => setCarrito([])}
      />
    </div>
  );
}
