import { useEffect, useState } from 'react';
import { CatalogoPage } from './features/catalogo/CatalogoPage';
import { AdminPage } from './features/admin/AdminPage';
import { SeguimientoPage } from './features/seguimiento/SeguimientoPage';
import { CuentaPage } from './features/cuenta/CuentaPage';

function rutaActual(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

// Enrutado mínimo por hash: "#/" catálogo del vecino, "#/seguimiento" estado de
// pedido, "#/cuenta" cuenta del vecino y "#/admin" panel interno.
export function App() {
  const [ruta, setRuta] = useState(rutaActual);

  useEffect(() => {
    const alCambiar = () => setRuta(rutaActual());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  if (ruta.startsWith('/admin')) return <AdminPage />;
  if (ruta.startsWith('/seguimiento')) return <SeguimientoPage />;
  if (ruta.startsWith('/cuenta')) return <CuentaPage />;
  return <CatalogoPage />;
}
