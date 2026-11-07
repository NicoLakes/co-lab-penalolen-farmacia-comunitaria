import { useState } from 'react';
import logoPenalolen from '../../assets/logo-penalolen.png';
import { MEDICAMENTOS_INICIALES } from './medicamentos.mock';
import type { Medicamento } from './medicamentos.mock';
import { CarritoPanel } from './CarritoPanel';
import type { ItemCarrito } from './CarritoPanel';

export function CatalogoPage() {
  // 1. Estados: memoria que hace interactiva la página
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('TODAS');
  const [modoSimple, setModoSimple] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);

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

  // 2. Categorías terapéuticas para el filtro
  const categorias = [
    'TODAS',
    ...Array.from(new Set(MEDICAMENTOS_INICIALES.map((m) => m.clasificacionTerapeutica))),
  ];

  // 3. Filtramos los medicamentos según lo que escribió el vecino y la categoría elegida
  const medicamentosFiltrados = MEDICAMENTOS_INICIALES.filter((med: Medicamento) => {
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
          <div className="logo-muni-wrap">
            <img
              src={logoPenalolen}
              alt="Municipalidad de Peñalolén"
              className="logo-muni"
            />
          </div>
          <h1>Farmacia Comunitaria</h1>
          <p className="subtitulo">
            {modoSimple
              ? 'Paso 1: Escriba el nombre de su remedio abajo para buscarlo.'
              : 'Consulta disponibilidad, precios solidarios y solicita tus medicamentos en línea.'}
          </p>
        </div>
        {/* Acciones del encabezado: Modo Simple */}
        <div className="header-actions">
          <button
            type="button"
            className={modoSimple ? 'btn-modo-simple activo' : 'btn-modo-simple'}
            onClick={() => setModoSimple(!modoSimple)}
          >
            {modoSimple ? 'Modo Simple Activado (Ver vista estándar)' : 'Activar Modo Simple (Letra Grande)'}
          </button>
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
      <section className="grilla-medicamentos">
        {medicamentosFiltrados.map((med) => (
          <article key={med.codigo} className="card-medicamento">
            <div className="card-top">
              <span className="tag-categoria">{med.clasificacionTerapeutica}</span>
              <span className={med.requiereReceta ? 'tag-receta obligatoria' : 'tag-receta libre'}>
                {med.requiereReceta ? 'Requiere Receta Médica' : 'Venta directa'}
              </span>
            </div>
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
        {medicamentosFiltrados.length === 0 && (
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
      />
    </div>
  );
}
