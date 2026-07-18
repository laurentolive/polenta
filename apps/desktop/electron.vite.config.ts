import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
        '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [
      react(),
      TanStackRouterVite({
        routesDirectory: './routes',
        generatedRouteTree: './routeTree.gen.ts',
      }),
    ],
    root: './src/renderer',
    resolve: {
      alias: {
        '@polenta/types': resolve(__dirname, '../../packages/types/src/index.ts'),
        '@polenta/zod-schemas': resolve(__dirname, '../../packages/zod-schemas/src/index.ts'),
        '@polenta/api-client': resolve(__dirname, '../../packages/api-client/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
