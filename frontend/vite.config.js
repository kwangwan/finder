import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Load .env from the repo root instead of frontend/, so there is a single
  // .env file to manage (only VITE_-prefixed keys are exposed to client code).
  envDir: '..',
  plugins: [react()],
  optimizeDeps: {
    // The map library ships a web worker beside its main module, and the dev
    // server's dependency pre-bundling rewrites the module without carrying
    // the worker with it — the worker then 404s, no tiles are ever requested
    // and the map is a black rectangle. Only in dev: a production build emits
    // the worker properly. Excluded so that what is developed against is what
    // ships.
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
