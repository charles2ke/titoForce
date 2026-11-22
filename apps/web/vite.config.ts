import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.TITO_PORT ?? process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.TITO_WEB_PORT ?? 5173),
    // ws: live updates (/api/realtime) are a WebSocket.
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
