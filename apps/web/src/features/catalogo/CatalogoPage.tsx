import { useCallback, useEffect, useState } from 'react';
import logoPenalolen from '../../assets/logo-penalolen.png';
import { AccountPanel } from '../auth/AccountPanel';
import type { Account } from '../auth/AccountPanel';
import { AdminSection } from '../admin/AdminSection';
import { ManagementSection } from '../management/ManagementSection';
import { OrdersSection } from '../orders/OrdersSection';
import { MEDICAMENTOS_INICIALES } from './medicamentos.mock';
import type { Medicamento } from './medicamentos.mock';
import { CarritoPanel } from './CarritoPanel';
import type { ItemCarrito } from './CarritoPanel';

interface CatalogItem {
  id: string;
  code: string;
  description: string;
  activeIngredient: string;
  dosageForm: string;
  presentation: string;
  supplier: string;
  therapeuticCategory: string;
  priceClp: number;
  stock: number;
  saleCondition?: string;
  requiresPrescription: boolean;
}

function isCatalogItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'code', 'description', 'activeIngredient', 'dosageForm', 'presentation', 'supplier', 'therapeuticCategory']
    .every((key) => typeof item[key] === 'string')
    && typeof item.priceClp === 'number' && Number.isSafeInteger(item.priceClp) && item.priceClp > 0
    && typeof item.stock === 'number' && Number.isSafeInteger(item.stock) && item.stock >= 0
    && typeof item.requiresPrescription === 'boolean';
}

export function CatalogoPage() {
  // 1. Estados: memoria que hace interactiva la página
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>(MEDICAMENTOS_INICIALES);
  const [fuenteBaseDatos, setFuenteBaseDatos] = useState(false);
  const [deliveryFeeClp, setDeliveryFeeClp] = useState<number | null>(null);
  const [cuentaActiva, setCuentaActiva] = useState<Account | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('TODAS');
  const [modoSimple, setModoSimple] = useState(false);
  const [vistaActiva, setVistaActiva] = useState<'catalogo' | 'pedidos' | 'admin' | 'gestion'>('catalogo');
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [menuCuentaAbierto, setMenuCuentaAbierto] = useState(false);

  const handleAccountChange = useCallback((account: Account | null) => {
    setCuentaActiva(account);
    if (!account) setVistaActiva('catalogo');
  }, []);

  const cargarCatalogo = useCallback((signal?: AbortSignal) => {
    return fetch('/api/catalog', signal ? { signal } : undefined).then(async (response) => {
      if (!response.ok) throw new Error('Catalog unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)
        || !data.items.every(isCatalogItem) || !('deliveryFeeClp' in data)) {
        throw new Error('Invalid catalog response');
      }
      const fee = data.deliveryFeeClp;
      if (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) {
        throw new Error('Invalid delivery fee');
      }
      if (signal?.aborted) return;
      const catalogo = data.items.map((item) => ({
        id: item.id,
        codigo: item.code,
        principioActivo: item.activeIngredient,
        descriptor: item.description,
        formaFarmaceutica: item.dosageForm,
        presentacion: item.presentation,
        proveedor: item.supplier,
        clasificacionTerapeutica: item.therapeuticCategory,
        precio: item.priceClp,
        stock: item.stock,
        requiereReceta: item.requiresPrescription,
        condicionVenta: typeof item.saleCondition === 'string' ? item.saleCondition : undefined,
      }));
      setMedicamentos(catalogo);
      const porCodigo = new Map(catalogo.map((medicamento) => [medicamento.codigo, medicamento]));
      setCarrito((actual) => actual.flatMap(({ medicamento, cantidad }) => {
        const actualizado = porCodigo.get(medicamento.codigo);
        return actualizado && actualizado.stock > 0
          ? [{ medicamento: actualizado, cantidad: Math.min(cantidad, actualizado.stock) }]
          : [];
      }));
      setFuenteBaseDatos(true);
      setDeliveryFeeClp(fee);
    }).catch(() => {
      if (!signal?.aborted) setDeliveryFeeClp(null);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void cargarCatalogo(controller.signal);
    return () => controller.abort();
  }, [cargarCatalogo]);

  function agregarAlCarrito(med: Medicamento) {
    if (med.stock <= 0) return;
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

  const puedeVerAdmin = Boolean(cuentaActiva?.roles.includes('user_admin'));
  const puedeVerGestion = Boolean(cuentaActiva?.roles.includes('pharmacy_operator'));
  const mostrandoGestion = vistaActiva === 'gestion' && puedeVerGestion;
  const mostrandoAdmin = vistaActiva === 'admin' && puedeVerAdmin;
  const mostrandoPedidos = vistaActiva === 'pedidos' && Boolean(cuentaActiva);

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
            {mostrandoAdmin
              ? 'Administración de cuentas y roles de la Farmacia Comunitaria.'
              : mostrandoGestion
                ? 'Gestión de stock y operación de funcionarios.'
                : mostrandoPedidos
              ? 'Seguimiento y estado de tus solicitudes de medicamentos.'
              : modoSimple
                ? 'Paso 1: Escriba el nombre de su remedio abajo para buscarlo.'
                : 'Consulta disponibilidad, precios solidarios y solicita tus medicamentos en línea.'}
            {!mostrandoAdmin && !mostrandoGestion && !mostrandoPedidos && !fuenteBaseDatos && ' · Catálogo de referencia'}
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={modoSimple ? 'btn-modo-simple activo' : 'btn-modo-simple'}
            onClick={() => setModoSimple(!modoSimple)}
          >
            {modoSimple ? 'Modo Simple Activado (Ver vista estándar)' : 'Activar Modo Simple (Letra Grande)'}
          </button>
          {modoSimple && cuentaActiva?.roles.includes('buyer') && (
            <button
              type="button"
              className={mostrandoPedidos ? 'btn-modo-simple activo' : 'btn-modo-simple'}
              onClick={() => setVistaActiva(mostrandoPedidos ? 'catalogo' : 'pedidos')}
            >
              {mostrandoPedidos ? 'Ver catálogo' : 'Mis pedidos'}
            </button>
          )}
          <AccountPanel
            onAccountChange={handleAccountChange}
            open={menuCuentaAbierto}
            onOpenChange={setMenuCuentaAbierto}
            onOpenOrders={() => setVistaActiva('pedidos')}
            onOpenAdmin={puedeVerAdmin ? () => setVistaActiva('admin') : undefined}
            onOpenManagement={puedeVerGestion ? () => setVistaActiva('gestion') : undefined}
          />
        </div>
      </header>

      {mostrandoAdmin && cuentaActiva ? (
        <AdminSection
          account={cuentaActiva}
          onBackToCatalog={() => setVistaActiva('catalogo')}
        />
      ) : mostrandoGestion && cuentaActiva ? (
        <ManagementSection
          account={cuentaActiva}
          onBackToCatalog={() => setVistaActiva('catalogo')}
          onCatalogChanged={() => void cargarCatalogo()}
        />
      ) : mostrandoPedidos ? (
        <OrdersSection
          modoSimple={modoSimple}
          demoPayments={cuentaActiva?.demoPayments === true}
          onBackToCatalog={() => setVistaActiva('catalogo')}
          onOrderCancelled={() => void cargarCatalogo()}
        />
      ) : (
        <>
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
                    {med.condicionVenta === 'prescription_cheque'
                      ? 'Receta cheque · Solo presencial'
                      : med.requiereReceta
                        ? 'Requiere Receta Médica'
                        : 'Venta directa'}
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
                    disabled={med.stock <= 0}
                    onClick={() => agregarAlCarrito(med)}
                  >
                    {med.stock > 0 ? '+ Agregar al carrito' : 'Sin stock'}
                  </button>
                </div>
              </article>
            ))}
            {medicamentosFiltrados.length === 0 && (
              <p className="sin-resultados">
                No encontramos medicamentos con &quot;{busqueda}&quot;. Intente con otro nombre.
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
        </>
      )}

      <CarritoPanel
        key={cuentaActiva?.email}
        carrito={carrito}
        abierto={carritoAbierto}
        usuarioEmail={cuentaActiva?.email}
        demoPayments={cuentaActiva?.demoPayments === true}
        deliveryFeeClp={deliveryFeeClp}
        onCerrar={() => setCarritoAbierto(false)}
        onCambiarCantidad={cambiarCantidad}
        onSolicitarInicioSesion={() => {
          setCarritoAbierto(false);
          setMenuCuentaAbierto(true);
        }}
        onVerMisPedidos={() => {
          setCarritoAbierto(false);
          setVistaActiva('pedidos');
        }}
        onStockAgotado={() => {
          void cargarCatalogo();
        }}
        onPedidoCreado={() => {
          setCarrito([]);
          void cargarCatalogo();
        }}
      />
    </div>
  );
}
