/**
 * GH63 — routes `/admin/api/*` du serveur web (specs/GH63-design.md §3.3, §5.1). Relais vers l'API
 * interne du service `polenta-admin` : le web-server ne parle jamais à Docker, à /opt/polenta ni à
 * l'agent. Chaque requête : session (CSRF sur mutation), refus des sessions d'impression et du mode
 * dev (sauf POLENTA_WEB_ADMIN_DEV=1 hors production), puis appel du service avec le jeton de service
 * de l'instance et le jeton forge de l'utilisateur. Le droit « propriétaire » est revérifié par le
 * service auprès de la forge (une seule source de vérité : aucun rôle n'est stocké ici).
 *
 * Hors `channel-policy.ts` : ce n'est pas un channel `/rpc` (critère 19).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Readable } from 'stream'
import type { AdminConfig } from '../config'
import type { Session } from '../session'
import { AdminClient } from './admin-client'

export interface AdminRouteDeps {
  admin: AdminConfig | null
  requireSession(req: FastifyRequest, reply: FastifyReply, mutating: boolean): Session | null
  /** Jeton forge de l'utilisateur (OAuth rafraîchi, ou celui du mode dev). */
  userToken(session: Session): Promise<string | null>
  fetchImpl?: typeof fetch
}

// Chemins relayés (liste fermée, segments à motif strict) : ceux de l'API du service.
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}'
const ROUTES: { method: string; re: RegExp }[] = [
  { method: 'GET', re: /^\/me$/ },
  { method: 'GET', re: /^\/instances$/ },
  { method: 'GET', re: new RegExp(`^/instances/${SEGMENT}$`) },
  { method: 'GET', re: /^\/jobs$/ },
  { method: 'POST', re: /^\/jobs$/ },
  { method: 'GET', re: new RegExp(`^/jobs/${SEGMENT}$`) },
  { method: 'GET', re: new RegExp(`^/jobs/${SEGMENT}/log$`) },
  { method: 'GET', re: new RegExp(`^/jobs/${SEGMENT}/secret$`) },
  { method: 'POST', re: new RegExp(`^/jobs/${SEGMENT}/cancel$`) },
  { method: 'GET', re: new RegExp(`^/backups/${SEGMENT}$`) },
  { method: 'GET', re: /^\/dns$/ },
  { method: 'GET', re: /^\/audit$/ },
  { method: 'GET', re: /^\/audit\.csv$/ },
  // Sprint 5
  { method: 'GET', re: /^\/exports$/ },
  { method: 'GET', re: new RegExp(`^/exports/${SEGMENT}/download$`) },
  { method: 'GET', re: /^\/host\/s3$/ },
  { method: 'GET', re: /^\/s3\/purge-preview$/ },
  { method: 'POST', re: /^\/users\/import\/preview$/ },
  { method: 'GET', re: /^\/users\/access-report$/ },
  { method: 'GET', re: /^\/users\/invite$/ },
]

const QUERY_KEYS = new Set(['state', 'instance', 'offset', 'from', 'domain', 'name', 'login'])
// Téléchargement d'une archive d'export : relayé en flux (plusieurs Go), jamais mis en mémoire.
const DOWNLOAD_RE = new RegExp(`^/exports/${SEGMENT}/download$`)

function deny(reply: FastifyReply, code: number, message: string) {
  return reply.code(code).header('Cache-Control', 'no-store').send({ ok: false, error: { code: code === 404 ? 'not-found' : 'forbidden', message } })
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const client = deps.admin ? new AdminClient(deps.admin, deps.fetchImpl) : null

  /**
   * Découverte par le renderer, toujours en 200 : `{available: false}` quand l'administration est
   * désactivée, injoignable ou que l'utilisateur n'est pas propriétaire. Évite une erreur 403/404
   * dans la console du navigateur de chaque utilisateur (S4-2, S4-7) ; `/admin/api/me` garde ses codes.
   */
  app.get('/admin/status', async (req, reply) => {
    void reply.header('Cache-Control', 'no-store')
    if (!client) return { available: false }
    const session = deps.requireSession(req, reply, false)
    if (!session) return reply
    if (session.print) return { available: false }
    const token = await deps.userToken(session)
    if (!token) return { available: false }
    const res = await client.forward({ method: 'GET', path: '/me', userToken: token, actor: session.login, clientIp: req.ip })
    if (res.status !== 200) return { available: false }
    try {
      return { available: true, me: JSON.parse(res.body.toString()) }
    } catch {
      return { available: false }
    }
  })

  app.route({
    method: ['GET', 'POST'],
    url: '/admin/api/*',
    handler: async (req, reply) => {
      if (!client || !deps.admin) return deny(reply, 404, 'Introuvable')
      const mutating = req.method !== 'GET'
      const session = deps.requireSession(req, reply, mutating)
      if (!session) return reply
      if (session.print) return deny(reply, 403, "Administration indisponible depuis une session d'impression.")
      const url = new URL(req.url, 'http://local')
      const sub = url.pathname.slice('/admin/api'.length)
      if (!ROUTES.some(r => r.method === req.method && r.re.test(sub))) return deny(reply, 404, 'Introuvable')
      const query = new URLSearchParams()
      for (const [k, v] of url.searchParams) if (QUERY_KEYS.has(k)) query.set(k, v.slice(0, 256))
      const token = await deps.userToken(session)
      if (!token) return deny(reply, 403, 'Jeton de la forge indisponible pour cette session.')
      if (DOWNLOAD_RE.test(sub)) {
        const res = await client.stream({ path: sub, userToken: token, actor: session.login, clientIp: req.ip })
        void reply.code(res.status).header('Cache-Control', 'no-store')
        for (const h of ['content-type', 'content-length', 'content-disposition']) {
          const value = res.headers.get(h)
          if (value) void reply.header(h, value)
        }
        return reply.send(res.body ? Readable.fromWeb(res.body as import('stream/web').ReadableStream) : '')
      }
      const res = await client.forward({
        method: req.method as 'GET' | 'POST',
        path: sub + (query.size ? `?${query}` : ''),
        body: mutating ? req.body : undefined,
        userToken: token,
        actor: session.login,
        clientIp: req.ip,
      })
      void reply.code(res.status).header('Cache-Control', 'no-store').header('Content-Type', res.contentType)
      if (res.disposition) void reply.header('Content-Disposition', res.disposition)
      return reply.send(res.body)
    },
  })
}
