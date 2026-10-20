import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET = 'http://127.0.0.1:3001' } = loadEnv(mode, process.cwd(), 'API_');

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: API_PROXY_TARGET } },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
