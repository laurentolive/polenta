/**
 * GH78 — rendu Vega-Lite des 3 widgets (lignes produites par le bac à sable sur la démo), sous CSP
 * stricte, dans Electron et dans Chromium (Playwright). Écrit `results/render-*.png|json`.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { build as viteBuild } from 'vite'
import { chromium } from 'playwright-core'
import { loadQuickJS, runFresh } from '../sandbox'
import { loadLibrary, loadWidget, WIDGETS, type WidgetKey } from '../widgets'

const SPIKE = path.resolve(__dirname, '..')
const APP = path.resolve(SPIKE, '../..')
const RESULTS = path.join(SPIKE, 'results')
const SITE = path.join(SPIKE, '.data/render-site')
const SRC = path.join(SPIKE, '.data/render-src')
const PORT = 8798
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"

async function rows() {
  const graphJson = fs.readFileSync(path.join(RESULTS, 'graph-demo.json'), 'utf8')
  const qjs = await loadQuickJS()
  const out: Record<string, unknown> = {}
  const params: Record<WidgetKey, Record<string, unknown>> = { a: {}, b: {}, c: { campaignId: 'CAMP-0002' } }
  for (const k of Object.keys(WIDGETS) as WidgetKey[]) {
    const r = runFresh(qjs, graphJson, loadLibrary(), loadWidget(k).script, { contractVersion: 1, now: '2026-10-13T12:00:00Z', params: params[k] })
    if (!r.ok) throw new Error(`${k}: ${r.error.message}`)
    out[k] = r.rows
  }
  return out
}

async function buildSite() {
  const css = fs.readFileSync(path.join(APP, 'src/renderer/index.css'), 'utf8')
  const tokens = css.slice(css.indexOf('/* THEME:GENERATED:START'), css.indexOf('/* THEME:GENERATED:END */'))
  fs.rmSync(SRC, { recursive: true, force: true })
  fs.mkdirSync(path.join(SRC, 'public/data'), { recursive: true })
  fs.writeFileSync(path.join(SRC, 'tokens.css'), `${tokens}\nbody{margin:0;font-family:system-ui;background:rgb(var(--canvas))}\nsection{padding:16px;background:rgb(var(--canvas));color:rgb(var(--ink))}\n.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}\n.widget{background:rgb(var(--surface));border:1px solid rgb(var(--edge));border-radius:8px;padding:8px;min-height:200px}\n`)
  fs.writeFileSync(path.join(SRC, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>GH78 rendu</title><link rel="stylesheet" href="./tokens.css"></head><body><section id="light"><h3>Thème clair</h3><div class="grid"></div></section><section id="dark" class="dark"><h3>Thème sombre</h3><div class="grid"></div></section><script type="module" src="${path.join(SPIKE, 'render/page.ts').replace(/\\/g, '/')}"></script></body></html>`)
  const specs = Object.fromEntries((Object.keys(WIDGETS) as WidgetKey[]).map(k => [k, loadWidget(k).spec]))
  fs.writeFileSync(path.join(SRC, 'public/data/specs.json'), JSON.stringify(specs))
  fs.writeFileSync(path.join(SRC, 'public/data/rows.json'), JSON.stringify(await rows()))
  await viteBuild({ configFile: false, logLevel: 'error', root: SRC, base: './', server: { fs: { allow: [APP, path.resolve(APP, '../..')] } }, build: { outDir: SITE, emptyOutDir: true, minify: true, target: 'chrome120' } })
}

function serve(): Promise<http.Server> {
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }
  const server = http.createServer((req, res) => {
    const p = path.join(SITE, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'))
    if (!p.startsWith(SITE) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return }
    // CSP aussi en en-tête HTTP (comme le ferait le serveur web) en plus de la balise meta.
    res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream', 'content-security-policy': CSP })
    fs.createReadStream(p).pipe(res)
  })
  return new Promise(res => server.listen(PORT, '127.0.0.1', () => res(server)))
}

export async function runRender() {
  fs.mkdirSync(RESULTS, { recursive: true })
  await buildSite()
  const server = await serve()
  const url = `http://127.0.0.1:${PORT}/index.html`
  const out: Record<string, unknown> = { csp: CSP }
  try {
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1400, height: 1700 } })
    const consoleLines: string[] = []
    page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`))
    await page.goto(url)
    await page.waitForFunction(() => (window as unknown as { __gh78?: { done: boolean } }).__gh78?.done, null, { timeout: 30000 })
    const report = await page.evaluate(() => (window as unknown as { __gh78: unknown }).__gh78)
    await page.screenshot({ path: path.join(RESULTS, 'render-chromium.png'), fullPage: true })
    out.chromium = { version: browser.version(), report, console: consoleLines.slice(0, 30) }
    await browser.close()

    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS // chargeur tsx hérité : fait planter Electron au démarrage
    const electronBin = require('electron') as unknown as string
    const jsonOut = path.join(SPIKE, '.data/render-electron.json')
    Object.assign(env, { GH78_URL: url, GH78_PNG: path.join(RESULTS, 'render-electron.png'), GH78_JSON: jsonOut })
    // spawn asynchrone : le serveur HTTP de ce process doit continuer à répondre.
    const r = await new Promise<{ status: number | null; stderr: string }>(resolve => {
      const p = spawn(electronBin, [path.join(SPIKE, 'render/electron-main.cjs')], { env })
      let stderr = ''
      p.stderr.on('data', d => { stderr += d })
      const timer = setTimeout(() => p.kill(), 90000)
      p.on('close', status => { clearTimeout(timer); resolve({ status, stderr }) })
    })
    out.electron = fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf8')) : { status: r.status, stderr: r.stderr.slice(0, 800) }
  } finally {
    server.close()
  }
  fs.writeFileSync(path.join(RESULTS, 'render.json'), JSON.stringify(out, null, 2))
  return out
}

if (require.main === module) void runRender().then(r => console.log(JSON.stringify(r, null, 1).slice(0, 6000))).catch(e => { console.error(e); process.exit(1) })
