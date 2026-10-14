import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// API proxy target for development.
//
// Default: local Node API on port 8787 (npm run dev:api).
//
// Optional: point at a remote API instead of local Node:
//   VITE_API_URL=https://proppik360.proppik.cloud
//
// Use 127.0.0.1 (not localhost) on Windows — IPv6 localhost can miss the API.
const API_TARGET = process.env.VITE_API_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  // Serve frontend source from src/frontend/
  root: 'src/frontend',

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/frontend/src'),
    },
  },

  build: {
    // Output built files to dist/public/ for nginx / static hosting on VPS
    outDir: '../../dist/public',
    emptyOutDir: true,
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy /api/* to the local Node API (port 8787).
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
