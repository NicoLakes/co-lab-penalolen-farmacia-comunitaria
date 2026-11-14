import { useEffect, useState } from 'react';
import { vecinoActual } from '../features/cuenta/cuenta.api';

// Sesión conocida, compartida entre encabezados para que el botón no parpadee
// al cambiar de página, y evento que avisa cuando inicia o cierra sesión.
let sesionConocida: boolean | null = null;
const EVENTO_SESION = 'sesion-vecino-cambio';

// Acceso a la cuenta del encabezado (HU-03): "Iniciar sesión" sin sesión
// vigente y "Mi cuenta" cuando el vecino ya entró.
export function BotonCuenta() {
  const [conSesion, setConSesion] = useState<boolean | null>(sesionConocida);

  useEffect(() => {
    const refrescar = () => {
      vecinoActual()
        .then(() => {
          sesionConocida = true;
          setConSesion(true);
        })
        .catch(() => {
          sesionConocida = false;
          setConSesion(false);
        });
    };

    refrescar();
    window.addEventListener(EVENTO_SESION, refrescar);
    return () => window.removeEventListener(EVENTO_SESION, refrescar);
  }, []);

  return (
    <a className="btn-admin" href="#/cuenta">
      {conSesion ? 'Mi cuenta' : 'Iniciar sesión'}
    </a>
  );
}
