import * as http from 'http'
import type { AddressInfo } from 'net'

/**
 * GH45 — faux serveur de forge pour les tests : chaque route renvoie une réponse mesurée sur une
 * vraie instance (Forgejo 15.0.9 / Gitea 28.1.0, specs/GH45-sprint1.md §6). Enregistre les requêtes
 * reçues (méthode, chemin, en-têtes, corps) pour vérifier ce que Polenta envoie.
 */
export interface FakeRequest {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  body: string
}

export type FakeHandler = (req: FakeRequest) => { status: number; json?: unknown; text?: string; contentType?: string; location?: string }

export interface FakeForge {
  baseUrl: string
  requests: FakeRequest[]
  route(method: string, path: string, handler: FakeHandler): void
  close(): Promise<void>
}

export async function startFakeForge(): Promise<FakeForge> {
  const routes = new Map<string, FakeHandler>()
  const requests: FakeRequest[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0]
      const record: FakeRequest = { method: req.method ?? 'GET', path, headers: req.headers, body }
      requests.push(record)
      const handler = routes.get(`${record.method} ${path}`)
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found.\n')
        return
      }
      const out = handler(record)
      if (out.json !== undefined) {
        res.writeHead(out.status, { 'Content-Type': 'application/json;charset=utf-8' })
        res.end(JSON.stringify(out.json))
      } else {
        res.writeHead(out.status, {
          'Content-Type': out.contentType ?? 'text/plain; charset=utf-8',
          ...(out.location ? { Location: out.location } : {}),
        })
        res.end(out.text ?? '')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    route: (method, path, handler) => { routes.set(`${method} ${path}`, handler) },
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

/** Réponses anonymes d'une forge qui exige la connexion (mesure §12). */
export const SIGNED_IN_ONLY = { status: 403, json: { message: 'Only signed in user is allowed to call APIs.' } }
