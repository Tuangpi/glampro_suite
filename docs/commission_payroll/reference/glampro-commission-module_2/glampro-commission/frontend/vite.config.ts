import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// "@backend" lets the UI's demo/mock mode run the REAL backend services in the browser
// (in-memory repository). In production set VITE_API_URL and the UI calls the REST API instead.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@backend': fileURLToPath(new URL('../backend/src', import.meta.url)) } },
  server: { port: 5173 },
});
