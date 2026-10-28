/**
 * GH63 — point d'entrée du service `polenta-admin` (conteneur, uid 1500). Écoute sur le réseau
 * interne polenta-admin-net uniquement (aucun port publié par le compose).
 */
import { loadConfig } from './config'
import { createService } from './service'

const cfg = loadConfig()
const app = createService(cfg)

app
  .listen({ host: cfg.listenHost, port: cfg.port })
  .then(() => console.log(`polenta-admin : API interne sur ${cfg.listenHost}:${cfg.port}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  // Les travaux en cours sont des processus détachés : ils continuent, et seront repris au démarrage.
  process.on(sig, () => {
    app.close().finally(() => process.exit(0))
  })
}
