import * as http from 'http'

import { SSO_CALLBACK_PATH, SsoLoginError } from './forgejo-sso'

/**
 * GH51 — serveur de retour de la connexion au navigateur (C10) : écoute sur `127.0.0.1` uniquement,
 * port attribué par le système (D1), un seul retour accepté sur `/callback`, fermeture dans tous les
 * cas (retour, délai, annulation, erreur de liaison).
 */

export interface CallbackParams {
  code?: string
  state?: string
  error?: string
}

export interface LoopbackCallback {
  /** `http://127.0.0.1:<port>/callback`, valide une fois le serveur à l'écoute. */
  redirectUri: string
  /** Premier retour valide ; rejette avec `cancelled` ou `timeout` si l'attente s'arrête avant. */
  result: Promise<CallbackParams>
  /** Ferme le serveur et termine l'attente (`cancelled`). Sans effet après un retour ou un délai. */
  cancel(): void
}

export interface LoopbackOptions {
  timeoutMs: number
  /** Injection pour les tests (échec de liaison). */
  createServer?: (listener: http.RequestListener) => http.Server
}

/** Page renvoyée au navigateur : aucune donnée de la requête n'y figure. */
const DONE_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion</title></head>
<body style="font-family:sans-serif;padding:2rem"><p>Connexion terminée. Vous pouvez fermer cet onglet et revenir à Polenta.</p></body></html>`

export function startLoopbackCallback(opts: LoopbackOptions): Promise<LoopbackCallback> {
  const create = opts.createServer ?? ((listener: http.RequestListener) => http.createServer(listener))
  let settled = false
  let resolveResult!: (params: CallbackParams) => void
  let rejectResult!: (err: Error) => void
  const result = new Promise<CallbackParams>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // Un rejet non consommé (annulation après retour, par exemple) ne doit pas remonter comme erreur.
  result.catch(() => undefined)

  const server = create((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== SSO_CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found.\n')
      return
    }
    if (settled) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Connexion déjà traitée.\n')
      return
    }
    settled = true
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(DONE_PAGE)
    // Le navigateur garde la connexion ouverte (keep-alive) : elle est fermée une fois la page envoyée.
    res.once('finish', () => server.closeIdleConnections())
    finish()
    resolveResult({
      ...(url.searchParams.has('code') ? { code: url.searchParams.get('code') ?? '' } : {}),
      ...(url.searchParams.has('state') ? { state: url.searchParams.get('state') ?? '' } : {}),
      ...(url.searchParams.has('error') ? { error: url.searchParams.get('error') ?? '' } : {}),
    })
  })

  const timer = setTimeout(() => stop(new SsoLoginError('timeout')), opts.timeoutMs)

  function finish(): void {
    clearTimeout(timer)
    server.close()
  }

  function stop(err: SsoLoginError): void {
    if (settled) return
    settled = true
    finish()
    rejectResult(err)
  }

  return new Promise<LoopbackCallback>((resolve, reject) => {
    let listening = false
    server.on('error', () => {
      // Avant l'écoute : liaison refusée, rien n'est en attente, l'appelant reçoit `bind` sans délai.
      if (listening) return
      settled = true
      clearTimeout(timer)
      reject(new SsoLoginError('bind'))
    })
    server.listen(0, '127.0.0.1', () => {
      listening = true
      const address = server.address()
      if (!address || typeof address === 'string') {
        settled = true
        clearTimeout(timer)
        server.close()
        reject(new SsoLoginError('bind'))
        return
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}${SSO_CALLBACK_PATH}`,
        result,
        cancel: () => stop(new SsoLoginError('cancelled')),
      })
    })
  })
}
