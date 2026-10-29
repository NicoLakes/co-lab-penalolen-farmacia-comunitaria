import { useState } from 'react';
import logoPenalolen from '../../assets/logo-penalolen.png';
import { MEDICAMENTOS_INICIALES } from './medicamentos.mock';
import type { Medicamento } from './medicamentos.mock';

export function CatalogoPage() {
  // 1. Estados: memoria que hace interactiva la página
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('TODAS');
  const [modoSimple, setModoSimple] = useState(false);

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
        {/* Botón destacado para Adultos Mayores (Requisito US-11 del Inception) */}
        <button
          type="button"
          className={modoSimple ? 'btn-modo-simple activo' : 'btn-modo-simple'}
          onClick={() => setModoSimple(!modoSimple)}
        >
          {modoSimple ? 'Modo Simple Activado (Ver vista estándar)' : 'Activar Modo Simple (Letra Grande)'}
        </button>
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
              <button type="button" className="btn-agregar">
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
    </div>
  );
}
