import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Medicamento } from './medicamentos.api';
import { recetasDelVecino, vecinoActual } from '../cuenta/cuenta.api';
import type { Receta, Vecino } from '../cuenta/cuenta.api';
import { recetaVigente } from '../cuenta/vigencia';

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
  onPedidoConfirmado: () => void;
}

type PasoCheckout = 'carrito' | 'formulario' | 'exito';

interface DatosCheckout {
  clienteNombre: string;
  contacto: string;
  modalidad: 'RETIRO' | 'DELIVERY';
  direccion: string;
}

const DATOS_INICIALES: DatosCheckout = {
  clienteNombre: '',
  contacto: '',
  modalidad: 'RETIRO',
  direccion: '',
};

export function CarritoPanel({
  carrito,
  abierto,
  onCerrar,
  onCambiarCantidad,
  onPedidoConfirmado,
}: CarritoPanelProps) {
  // Cálculos propios del carrito
  const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const totalPrecio = carrito.reduce(
    (acc, item) => acc + item.medicamento.precio * item.cantidad,
    0,
  );
  const carritoRequiereReceta = carrito.some((item) => item.medicamento.requiereReceta);

  // Checkout mínimo: formulario → confirmación con número de pedido
  const [paso, setPaso] = useState<PasoCheckout>('carrito');
  const [datos, setDatos] = useState<DatosCheckout>(DATOS_INICIALES);
  const [enviando, setEnviando] = useState(false);
  const [errorCheckout, setErrorCheckout] = useState('');
  const [numeroPedido, setNumeroPedido] = useState<number | null>(null);

  // Cuenta del vecino: prellena el formulario y valida la cobertura de recetas.
  const [vecino, setVecino] = useState<Vecino | null>(null);
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [cuentaCargada, setCuentaCargada] = useState(false);

  // Al entrar al formulario usamos los datos de la cuenta (si hay sesión)
  // para no volver a pedirlos; siguen siendo editables.
  useEffect(() => {
    if (paso !== 'formulario' || cuentaCargada) return;
    let vigente = true;
    (async () => {
      try {
        const cuenta = await vecinoActual();
        if (!vigente) return;
        setVecino(cuenta);
        setDatos((actual) => ({
          ...actual,
          clienteNombre: actual.clienteNombre || cuenta.nombre,
          contacto: actual.contacto || cuenta.telefono || cuenta.email,
          direccion: actual.direccion || cuenta.direccion || '',
        }));
        const lista = await recetasDelVecino();
        if (vigente) setRecetas(lista);
      } catch {
        // Sin sesión el checkout continúa como invitado.
      } finally {
        if (vigente) setCuentaCargada(true);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [paso, cuentaCargada]);

  const recetasAceptadas = recetas.filter((receta) => recetaVigente(receta));
  const tieneRecetaPendiente = recetas.some((receta) => receta.estado === 'PENDIENTE');
  const tieneRecetaVencida = recetas.some(
    (receta) => receta.estado === 'ACEPTADA' && !recetaVigente(receta),
  );
  // Hay sesión comprobada pero sin cuenta: no se puede usar receta médica.
  const sinCuenta = cuentaCargada && !vecino;

  // Medicamentos con receta que no están cubiertos por una receta aceptada.
  const faltantes: string[] = [];
  if (cuentaCargada && vecino && carritoRequiereReceta) {
    const autorizado = new Map<string, number>();
    for (const receta of recetasAceptadas) {
      for (const item of receta.items) {
        autorizado.set(item.codigo, (autorizado.get(item.codigo) ?? 0) + item.cantidad);
      }
    }
    for (const item of carrito) {
      if (!item.medicamento.requiereReceta) continue;
      const cubierta = autorizado.get(item.medicamento.codigo) ?? 0;
      if (cubierta === 0) {
        faltantes.push(`${item.medicamento.principioActivo}: no está en tu receta aprobada`);
      } else if (cubierta < item.cantidad) {
        faltantes.push(
          `${item.medicamento.principioActivo}: tu receta solo autoriza ${cubierta} unidad(es)`,
        );
      }
    }
  }
  const recetaBloquea =
    faltantes.length > 0 || (sinCuenta && carritoRequiereReceta);

  function cambiarCampo(campo: keyof DatosCheckout, valor: string) {
    setDatos((actual) => ({ ...actual, [campo]: valor }));
  }

  async function enviarPedido(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErrorCheckout('');
    setEnviando(true);

    try {
      const respuesta = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clienteNombre: datos.clienteNombre.trim(),
          contacto: datos.contacto.trim(),
          modalidad: datos.modalidad,
          ...(datos.modalidad === 'DELIVERY' ? { direccion: datos.direccion.trim() } : {}),
          items: carrito.map((item) => ({
            codigo: item.medicamento.codigo,
            cantidad: item.cantidad,
          })),
        }),
        signal: AbortSignal.timeout(10000),
      });

      const cuerpo: unknown = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        const mensaje =
          typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo
            ? String((cuerpo as { error: unknown }).error)
            : 'No se pudo registrar la solicitud.';
        throw new Error(mensaje);
      }

      const pedido =
        typeof cuerpo === 'object' && cuerpo !== null && 'pedido' in cuerpo
          ? (cuerpo as { pedido: { numero: number } }).pedido
          : null;
      setNumeroPedido(pedido?.numero ?? null);
      setPaso('exito');
      onPedidoConfirmado();
    } catch (error: unknown) {
      setErrorCheckout(
        error instanceof Error ? error.message : 'No se pudo registrar la solicitud.',
      );
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setPaso('carrito');
    setDatos(DATOS_INICIALES);
    setErrorCheckout('');
    setNumeroPedido(null);
    setCuentaCargada(false);
  }

  return (
    <>
      <div
        className={abierto ? 'carrito-backdrop abierto' : 'carrito-backdrop'}
        onClick={onCerrar}
        aria-hidden="true"
      />
      <aside
        className={abierto ? 'carrito-panel abierto' : 'carrito-panel'}
        aria-label="Carrito de compras"
        aria-hidden={!abierto}
      >
        <div className="carrito-header">
          <h2>Mi Solicitud de Compra ({totalUnidades} productos)</h2>
          <button type="button" className="btn-cerrar-carrito" onClick={onCerrar}>
            Cerrar
          </button>
        </div>

        {paso === 'exito' ? (
          <div className="checkout-exito" role="status">
            <h3>¡Solicitud registrada!</h3>
            <p>
              Tu pedido número <strong>#{numeroPedido ?? '—'}</strong> fue recibido. Te contactaremos
              por {datos.contacto} para coordinar{' '}
              {datos.modalidad === 'DELIVERY' ? 'la entrega a domicilio' : 'el retiro'}.
            </p>
            <button
              type="button"
              className="btn-continuar-checkout"
              onClick={() => {
                reiniciar();
                onCerrar();
              }}
            >
              Seguir comprando
            </button>
            <a
              className="btn-continuar-checkout btn-seguimiento-exito"
              href={numeroPedido ? `#/seguimiento?numero=${numeroPedido}` : '#/seguimiento'}
              onClick={() => {
                reiniciar();
                onCerrar();
              }}
            >
              Ver estado de mi pedido
            </a>
          </div>
        ) : carrito.length === 0 ? (
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
              <div className={recetaBloquea ? 'alerta-receta-isp bloqueo' : 'alerta-receta-isp'}>
                <strong>Aviso Normativa ISP:</strong> Tu carrito incluye medicamentos sujetos a
                control.{' '}
                {!cuentaCargada
                  ? 'Para comprarlos necesitas iniciar sesión con tu cuenta y adjuntar tu receta médica.'
                  : sinCuenta
                    ? 'Para comprarlos debes iniciar sesión con tu cuenta y adjuntar tu receta médica.'
                    : recetaBloquea
                      ? tieneRecetaVencida
                        ? 'Tu receta venció y ya no cubre medicamentos. Sube una nueva en «Mi cuenta»:'
                        : 'Estos medicamentos aún no están cubiertos por tu receta aceptada:'
                      : recetasAceptadas.length > 0
                        ? 'Puedes comprarlos: están cubiertos por tu receta aceptada.'
                        : tieneRecetaPendiente
                          ? 'Tu receta está en revisión. Podrás comprar cuando un funcionario la acepte.'
                          : 'Adjunta tu receta médica en «Mi cuenta» para que un funcionario la revise.'}
                {recetaBloquea && (
                  <ul>
                    {faltantes.map((motivo) => (
                      <li key={motivo}>{motivo}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {paso === 'carrito' ? (
              <div className="carrito-resumen">
                <div className="carrito-total-fila">
                  <span>Total estimado:</span>
                  <strong>${totalPrecio.toLocaleString('es-CL')}</strong>
                </div>
                <button
                  type="button"
                  className="btn-continuar-checkout"
                  onClick={() => setPaso('formulario')}
                >
                  Continuar con la Solicitud
                </button>
              </div>
            ) : (
              <form className="checkout-form" onSubmit={enviarPedido}>
                <h3>Datos de la solicitud</h3>

                <label htmlFor="checkout-nombre">Nombre y apellido</label>
                <input
                  id="checkout-nombre"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={datos.clienteNombre}
                  onChange={(e) => cambiarCampo('clienteNombre', e.target.value)}
                  placeholder="Ej: Juan Pérez"
                />

                <label htmlFor="contacto">Correo o teléfono de contacto</label>
                <input
                  id="contacto"
                  type="text"
                  required
                  minLength={3}
                  maxLength={160}
                  value={datos.contacto}
                  onChange={(e) => cambiarCampo('contacto', e.target.value)}
                  placeholder="Ej: 987654321 o juan@correo.cl"
                />

                <fieldset className="checkout-modalidad">
                  <legend>¿Cómo prefieres recibirlo?</legend>
                  <label>
                    <input
                      type="radio"
                      name="modalidad"
                      value="RETIRO"
                      checked={datos.modalidad === 'RETIRO'}
                      onChange={() => cambiarCampo('modalidad', 'RETIRO')}
                    />
                    Retiro en la farmacia
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="modalidad"
                      value="DELIVERY"
                      checked={datos.modalidad === 'DELIVERY'}
                      onChange={() => cambiarCampo('modalidad', 'DELIVERY')}
                    />
                    Delivery a domicilio
                  </label>
                </fieldset>

                {datos.modalidad === 'DELIVERY' && (
                  <>
                    <label htmlFor="checkout-direccion">Dirección de entrega</label>
                    <input
                      id="checkout-direccion"
                      type="text"
                      required
                      minLength={5}
                      maxLength={200}
                      value={datos.direccion}
                      onChange={(e) => cambiarCampo('direccion', e.target.value)}
                      placeholder="Ej: Av. Siempreviva 742, Peñalolén"
                    />
                  </>
                )}

                {recetaBloquea && (
                  <p className="checkout-error" role="alert">
                    {sinCuenta
                      ? 'No puedes confirmar el pedido: inicia sesión con tu cuenta para comprar medicamentos que requieren receta.'
                      : `No puedes confirmar el pedido: ${faltantes[0]}${
                          faltantes.length > 1 ? ` (y ${faltantes.length - 1} más)` : ''
                        }.`}
                  </p>
                )}

                {errorCheckout && (
                  <p className="checkout-error" role="alert">
                    {errorCheckout}
                  </p>
                )}

                <div className="carrito-resumen">
                  <div className="carrito-total-fila">
                    <span>Total estimado:</span>
                    <strong>${totalPrecio.toLocaleString('es-CL')}</strong>
                  </div>
                  <button
                    type="submit"
                    className="btn-continuar-checkout"
                    disabled={enviando || recetaBloquea}
                  >
                    {enviando ? 'Enviando…' : 'Confirmar solicitud'}
                  </button>
                  <button
                    type="button"
                    className="btn-volver-carrito"
                    onClick={() => setPaso('carrito')}
                    disabled={enviando}
                  >
                    Volver al carrito
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </aside>
    </>
  );
}
