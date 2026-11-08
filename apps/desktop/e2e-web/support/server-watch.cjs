'use strict'
/**
 * GH330 — préchargé dans le serveur web de test (`node --require`, cf. run-server.mjs) : rend visible
 * dans la sortie de la suite (`[WebServer]`) ce qui arrête le serveur. Il n'en change pas le
 * comportement : le serveur garde ses propres gestionnaires de SIGINT / SIGTERM.
 *
 * - signal reçu : journalisé ;
 * - sortie du processus : code, durée de vie, pic de mémoire ;
 * - mémoire envoyée au lanceur toutes les 5 s (dernière valeur connue en cas d'arrêt brutal, qui
 *   n'exécute aucun gestionnaire ici).
 */
const started = Date.now()
const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} Mo`
const log = (msg) => process.stderr.write(`[e2e] serveur web (pid ${process.pid}) : ${msg}\n`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => log(`signal ${signal} reçu, arrêt`))
}

process.on('exit', (code) => {
  const { heapUsed } = process.memoryUsage()
  log(`sortie code ${code} après ${Math.round((Date.now() - started) / 1000)} s ; mémoire : pic ${mb(process.resourceUsage().maxRSS * 1024)}, tas ${mb(heapUsed)}`)
})

if (process.send) {
  const sample = () => {
    const { rss, heapUsed } = process.memoryUsage()
    try { process.send({ rss, heapUsed }) } catch { /* lanceur parti */ }
  }
  setInterval(sample, 5000).unref()
  // Le canal ne doit pas retenir le processus.
  process.channel?.unref()
}
