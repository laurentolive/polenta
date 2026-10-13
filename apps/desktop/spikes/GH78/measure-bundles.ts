/**
 * GH78 — poids des bibliothèques dans les bundles (brut, gzip, brotli).
 *  - renderer (desktop et web : même code renderer, mêmes réglages Vite) : un build Vite par option,
 *    chargée paresseusement (chunk séparé) + un build combiné (découpage réel des chunks partagés) ;
 *  - Node (process main, serveur web, serveur MCP) : un bundle esbuild par option, comme
 *    `build:mcp-server` (cjs, platform node) ; le .wasm est un fichier à livrer à côté.
 *  - référence : taille actuelle des bundles de l'application (`electron-vite build`, `vite build -c
 *    vite.web.config.ts`, `build:mcp-server`) si `--baseline`.
 * Écrit `results/bundles.json`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { execSync } from 'node:child_process'
import { build as viteBuild } from 'vite'
import { build as esbuild } from 'esbuild'

const SPIKE = __dirname
const APP = path.resolve(SPIKE, '../..')
const OUT = path.join(SPIKE, '.data/bundles')
const RESULTS = path.join(SPIKE, 'results')

const kb = (n: number) => Math.round(n / 102.4) / 10
function sizeOf(files: string[]) {
  let raw = 0, gz = 0, br = 0
  for (const f of files) {
    const buf = fs.readFileSync(f)
    raw += buf.length
    gz += zlib.gzipSync(buf, { level: 9 }).length
    br += zlib.brotliCompressSync(buf).length
  }
  return { rawKb: kb(raw), gzipKb: kb(gz), brotliKb: kb(br) }
}
const walk = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]) : []
const byExt = (files: string[]) => ({
  js: sizeOf(files.filter(f => /\.(m?js|cjs)$/.test(f))),
  wasm: sizeOf(files.filter(f => f.endsWith('.wasm'))),
  all: sizeOf(files.filter(f => !f.endsWith('.map'))),
})

async function renderer(name: string, input: string) {
  const outDir = path.join(OUT, 'renderer', name)
  await viteBuild({
    configFile: false, logLevel: 'error', root: SPIKE,
    build: { outDir, emptyOutDir: true, minify: true, target: 'chrome120', sourcemap: false, rollupOptions: { input, preserveEntrySignatures: 'strict', output: { inlineDynamicImports: !input.includes('renderer-entry') } } },
  })
  const files = walk(outDir).filter(f => !f.endsWith('.html'))
  const entryFile = files.find(f => /renderer-entry.*\.js$/.test(path.basename(f)) || /index.*\.js$/.test(path.basename(f)))
  return { ...byExt(files), files: files.map(f => ({ file: path.relative(outDir, f).replace(/\\/g, '/'), ...sizeOf([f]) })), entry: entryFile && input.includes('renderer-entry') ? sizeOf([entryFile]) : undefined }
}

async function node(name: string, entry: string) {
  const outDir = path.join(OUT, 'node', name)
  fs.rmSync(outDir, { recursive: true, force: true })
  // Format du serveur MCP actuel (cjs) ; repli ESM si la bibliothèque ne s'y prête pas (consigné).
  let format: 'cjs' | 'esm' = 'cjs'
  let cjsError: string | null = null
  try {
    await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(outDir, 'index.cjs'), minify: false, logLevel: 'silent', loader: { '.wasm': 'file' } })
  } catch (e) {
    cjsError = String((e as Error).message).split('\n').slice(0, 3).join(' ')
    format = 'esm'
    await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(outDir, 'index.mjs'), minify: false, logLevel: 'error' })
  }
  // La variante wasmfile lit son .wasm à l'exécution : fichier à livrer à côté du bundle.
  if (name.includes('quickjs')) fs.copyFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'), path.join(outDir, 'emscripten-module.wasm'))
  const minDir = path.join(OUT, 'node-min', name)
  fs.rmSync(minDir, { recursive: true, force: true })
  await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format, outfile: path.join(minDir, format === 'cjs' ? 'index.cjs' : 'index.mjs'), minify: true, logLevel: 'error' })
  return { format, cjsError, unminified: byExt(walk(outDir)), minifiedJs: sizeOf(walk(minDir).filter(f => /\.(c|m)js$/.test(f))) }
}

function baseline() {
  const run = (cmd: string) => execSync(cmd, { cwd: APP, stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
  run('npx electron-vite build')
  const desktopRenderer = walk(path.join(APP, 'out/renderer')).filter(f => /\.(js|css|wasm)$/.test(f))
  const desktopMain = walk(path.join(APP, 'out/main')).filter(f => f.endsWith('.js'))
  run('npx vite build -c vite.web.config.ts')
  const web = walk(path.join(APP, 'out/web')).filter(f => /\.(js|css)$/.test(f))
  run('npx tsx scripts/build-mcp-server.ts')
  const mcp = walk(path.join(APP, 'out/mcp-server')).filter(f => f.endsWith('.cjs'))
  const biggestJs = (files: string[]) => { const f = files.filter(x => x.endsWith('.js')).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]; return f ? { file: path.basename(f), ...sizeOf([f]) } : null }
  return {
    desktopRenderer: { total: sizeOf(desktopRenderer), mainChunk: biggestJs(desktopRenderer) },
    desktopMain: sizeOf(desktopMain),
    web: { total: sizeOf(web), mainChunk: biggestJs(web) },
    mcpServer: sizeOf(mcp),
  }
}

export async function measureBundles(opts: { baseline?: boolean } = {}) {
  fs.mkdirSync(RESULTS, { recursive: true })
  const b = (f: string) => path.join(SPIKE, 'bundle', f)
  const result = {
    note: 'renderer = desktop ET web (même renderer, même Vite) ; node = main Electron, serveur web et serveur MCP (même code de service).',
    renderer: {
      'vega (runtime) + vega-interpreter': await renderer('vega-runtime', b('chunk-vega-runtime.ts')),
      'vega-lite (compilateur seul)': await renderer('vega-lite', b('chunk-vega-lite.ts')),
      'vega-embed + vega-lite + vega + interpréteur': await renderer('vega-embed', b('chunk-vega-embed.ts')),
      'quickjs (cœur + wasm)': await renderer('quickjs', b('chunk-quickjs.ts')),
      'combiné (point d\'entrée + 4 chargements paresseux)': await renderer('combined', b('renderer-entry.ts')),
    },
    node: {
      'quickjs (cœur + wasm)': await node('quickjs', b('chunk-quickjs.ts')),
      'vega-lite (compilateur seul)': await node('vega-lite', b('chunk-vega-lite.ts')),
    },
    baseline: opts.baseline ? baseline() : null,
  }
  fs.writeFileSync(path.join(RESULTS, 'bundles.json'), JSON.stringify(result, null, 2))
  return result
}

if (require.main === module) void measureBundles({ baseline: process.argv.includes('--baseline') }).then(r => console.log(JSON.stringify(r, (k, v) => (k === 'files' ? undefined : v), 1))).catch(e => { console.error(e); process.exit(1) })
