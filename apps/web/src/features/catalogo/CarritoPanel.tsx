import type { Medicamento } from './medicamentos.mock';

// 1. Molde de cada producto dentro del carrito
export interface ItemCarrito {
  medicamento: Medicamento;
  cantidad: number;
}

// 2. "Props": lo que CatalogoPage le envía a este componente para funcionar
interface CarritoPanelProps {
  carrito: ItemCarrito[];
  abierto: boolean;
  onCerrar: () => void;
  onCambiarCantidad: (codigo: string, nuevaCantidad: number) => void;
}

export function CarritoPanel({
  carrito,
  abierto,
  onCerrar,
  onCambiarCantidad,
}: CarritoPanelProps) {
  // Si el carrito está cerrado, no dibuja nada en pantalla
  if (!abierto) {
    return null;
  }

  // Cálculos propios del carrito
  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const totalPrecio = carrito.reduce(
    (acc, item) => acc + item.medicamento.precio * item.cantidad,
    0,
  );
  const carritoRequiereReceta = carrito.some((item) => item.medicamento.requiereReceta);

  return (
    <aside className="carrito-panel" aria-label="Carrito de compras">
      <div className="carrito-header">
        <h2>Mi Solicitud de Compra ({totalUnidades} productos)</h2>
        <button type="button" className="btn-cerrar-carrito" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      {carrito.length === 0 ? (
        <p className="carrito-vacio">Aún no has agregado medicamentos a tu carrito.</p>
      ) : (
        <>
          <ul className="carrito-lista">
            {carrito.map(({ medicamento, cantidad }) => (
              <li key={medicamento.codigo} className="carrito-item">
                <div className="carrito-item-info">
                  <strong>{medicamento.principioActivo}</strong>
                  <span>
                    ${medicamento.precio.toLocaleString('es-CL')} c/u
                    {medicamento.requiereReceta ? ' · Requiere receta' : ' · Venta directa'}
                  </span>
                </div>

                <div className="carrito-controles">
                  <button
                    type="button"
                    className="btn-cantidad"
                    onClick={() => onCambiarCantidad(medicamento.codigo, cantidad - 1)}
                  >
                    -
                  </button>
                  <span className="cantidad-valor">{cantidad}</span>
                  <button
                    type="button"
                    className="btn-cantidad"
                    onClick={() => onCambiarCantidad(medicamento.codigo, cantidad + 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {carritoRequiereReceta && (
            <div className="alerta-receta-isp">
              <strong>Aviso Normativa ISP:</strong> Tu carrito incluye medicamentos sujetos a
              control. En el siguiente paso deberás adjuntar tu receta médica para la visación del
              Químico-Farmacéutico previo al pago.
            </div>
          )}

          <div className="carrito-resumen">
            <div className="carrito-total-fila">
              <span>Total estimado:</span>
              <strong>${totalPrecio.toLocaleString('es-CL')}</strong>
            </div>
            <button type="button" className="btn-continuar-checkout">
              Continuar con la Solicitud
            </button>
          </div>
        </>
      )}
    </aside>
  );
}