import { useState } from 'react';
import { checkApiHealth } from './api/health';

export function App() {
  const [status, setStatus] = useState('Conexión pendiente de comprobar.');
  const [checking, setChecking] = useState(false);

  async function checkConnection() {
    setChecking(true);
    setStatus('Comprobando conexión…');
    try {
      await checkApiHealth();
      setStatus('API conectada correctamente.');
    } catch {
      setStatus('No se pudo conectar con la API. Inténtalo nuevamente.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">Ingeniería de Software</p>
      <h1>Monorepo listo para comenzar</h1>
      <p>React + Vite en web. Fastify en api. TypeScript en ambas aplicaciones.</p>
      <button type="button" disabled={checking} onClick={() => void checkConnection()}>
        {checking ? 'Comprobando…' : 'Comprobar conexión con la API'}
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
