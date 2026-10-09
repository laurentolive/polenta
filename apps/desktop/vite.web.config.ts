import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { resolve } from 'path'

/**
 * GH44 — build web du renderer desktop (même code, même routes), servi par le serveur web
 * (`src/web-server`). Point d'entrée `web.html` → `web/main.tsx` (bridge HTTP/WebSocket puis
 * renderer). Plugins et alias alignés sur la section `renderer` d'electron.vite.config.ts.
 *
 * `pnpm dev:web` : Vite sur 5180 (`POLENTA_WEB_CLIENT_PORT`), appels API relayés au serveur (8787).
 */
const SERVER = `http://127.0.0.1:${process.env['POLENTA_WEB_PORT'] ?? 8787}`
const API_PREFIXES = ['/rpc', '/auth', '/upload', '/download', '/healthz', '/events']

/**
 * Le fallback SPA de Vite servirait `index.html` (entrée desktop, sans bridge) : toute navigation
 * HTML (`/`, `/dashboard?…`) reçoit `web.html`, comme le fait le serveur web en production.
 */
function webHtmlFallback(): Plugin {
  return {
    name: 'polenta-web-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/'
        const isNavigation = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        if (isNavigation && !API_PREFIXES.some(p => url.startsWith(p)) && !/\.[a-z0-9]+(\?|$)/i.test(url.split('?')[0])) {
          req.url = '/web.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [
    TanStackRouterVite({
      routesDirectory: './routes',
      generatedRouteTree: './routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    webHtmlFallback(),
  ],
  resolve: {
    alias: {
      '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
      '@polenta/api-client': resolve(__dirname, '../../packages/api-client/src/index.ts'),
      '@polenta/merge-core': resolve(__dirname, '../../packages/merge-core/src/index.ts'),
    },
  },
  server: {
    port: Number(process.env['POLENTA_WEB_CLIENT_PORT'] ?? 5180),
    strictPort: true,
    open: '/',
    proxy: {
      '/rpc': SERVER,
      '/auth': SERVER,
      '/upload': SERVER,
      '/download': SERVER,
      '/healthz': SERVER,
      '/events': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/web.html') },
  },
})
