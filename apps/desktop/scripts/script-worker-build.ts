/**
 * GH74 — bundle autonome du worker du moteur de scripts (`src/main/services/script-worker.ts`) et
 * copie du `.wasm` de QuickJS à côté, pour les trois hôtes : main Electron (`out/main`, via le
 * plugin `scriptWorkerPlugin` de electron.vite.config.ts), serveur web et serveur MCP (scripts de
 * build esbuild). Un seul fichier, sans chunk partagé : il est chargé par `new Worker(path)` et,
 * dans l'app packagée, depuis `app.asar.unpacked` (cf. `asarUnpack`).
 */
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import { build } from 'esbuild'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import type { Plugin } from 'vite'

const root = path.resolve(__dirname, '..')
/** `require.resolve` absent quand ce fichier est bundlé avec electron.vite.config.ts. */
const resolveFrom = createRequire(path.join(root, 'package.json')).resolve

/** Le module Emscripten de QuickJS en version CommonJS : sa variante ESM (choisie pour un
 *  `import()`) lit `import.meta.url`, indéfini dans un bundle CJS. */
const emscriptenCjsPlugin: EsbuildPlugin = {
  name: 'quickjs-emscripten-cjs',
  setup(b) {
    b.onResolve({ filter: /^@jitl\/quickjs-wasmfile-release-sync\/emscripten-module$/ }, () => ({
      path: resolveFrom('@jitl/quickjs-wasmfile-release-sync/emscripten-module'),
    }))
  },
}

export async function buildScriptWorker(outDir: string): Promise<void> {
  const out = path.resolve(root, outDir)
  await build({
    absWorkingDir: root,
    entryPoints: ['src/main/services/script-worker.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: path.join(out, 'script-worker.js'),
    alias: {
      '@polenta/types': path.resolve(root, '../../packages/types/src/index.ts'),
    },
    plugins: [emscriptenCjsPlugin],
    // `require.resolve` du paquet wasm : repli hors bundle seulement (le .wasm est copié à côté).
    logOverride: { 'require-resolve-not-external': 'silent' },
    logLevel: 'warning',
  })
  fs.copyFileSync(resolveFrom('@jitl/quickjs-wasmfile-release-sync/wasm'), path.join(out, 'emscripten-module.wasm'))
}

/** Copie de la bibliothèque de départ à côté d'un bundle (serveur MCP). */
export function copyDashboardLib(outDir: string): void {
  const from = path.join(root, 'resources', 'dashboard-lib')
  const to = path.resolve(root, outDir, 'dashboard-lib')
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f))
}

/** Plugin electron-vite (main) : rebâtit le worker après chaque build du main (dev compris). */
export function scriptWorkerPlugin(outDir = 'out/main'): Plugin {
  return {
    name: 'polenta-script-worker',
    apply: () => true,
    async closeBundle() {
      await buildScriptWorker(outDir)
    },
  }
}
