/**
 * GH330 — lanceur du serveur web de test : `node e2e-web/support/run-server.mjs <script>`.
 *
 * Playwright ne signale pas un serveur web qui s'arrête en cours de suite : les tests suivants
 * échouent tous sur `ERR_CONNECTION_REFUSED`, sans cause. Le lanceur démarre le serveur avec
 * `server-watch.cjs` préchargé et, si le serveur s'arrête avant lui, écrit sur stderr (affiché
 * `[WebServer]` dans la sortie de la suite) le code de sortie ou le signal et sa mémoire.
 *
 * En fin de suite, Playwright tue l'arbre de processus (lanceur compris) : rien n'est écrit.
 */
import { spawn } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'

const script = process.argv[2]
if (!script) {
  process.stderr.write('usage : node run-server.mjs <script du serveur>\n')
  process.exit(2)
}
const watch = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server-watch.cjs')
const started = Date.now()
const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} Mo`

const child = spawn(process.execPath, ['--require', watch, script], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
let last = null
let peakRss = 0
child.on('message', (m) => {
  last = m
  peakRss = Math.max(peakRss, m.rss)
})

// Arrêt demandé au lanceur : transmis au serveur.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))

child.on('exit', (code, signal) => {
  const memory = last ? `dernière mesure rss ${mb(last.rss)}, tas ${mb(last.heapUsed)} ; pic rss mesuré ${mb(peakRss)}` : 'aucune mesure'
  process.stderr.write(
    `[e2e] serveur web (pid ${child.pid}) arrêté après ${Math.round((Date.now() - started) / 1000)} s : `
    + `${signal ? `signal ${signal}` : `code ${code}`} ; mémoire : ${memory}\n`,
  )
  process.exit(code ?? 1)
})
child.on('error', (err) => {
  process.stderr.write(`[e2e] serveur web : lancement impossible (${err.message})\n`)
  process.exit(1)
})
