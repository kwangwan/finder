import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Load .env from the repo root instead of frontend/, so there is a single
  // .env file to manage (only VITE_-prefixed keys are exposed to client code).
  envDir: '..',
  plugins: [react()],
  optimizeDeps: {
    // Dev only, and only to make development look like production. The map
    // library's worker is imported with ?worker&url so that the build folds
    // its dependencies in; the dev server's dependency pre-bundling gets in
    // the way of that and leaves the basemap unpainted, which made the map
    // impossible to look at while working on it.
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
