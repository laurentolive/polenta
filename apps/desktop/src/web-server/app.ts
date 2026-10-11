import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import { BRAND } from '../shared/brand'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import * as fsP from 'fs/promises'
import { pipeline } from 'stream/promises'
import * as path from 'path'
import { parseForgeAccessError } from '@polenta/types'
import { LOGIN_PATTERN, type WebConfig } from './config'
import { isExposed } from './channel-policy'
import { checkArgs, PathGuardError } from './path-guard'
import {
  SessionStore, PendingAuthorizations, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, OIDC_STATE_COOKIE, csrfMatches,
  type Session,
} from './session'
import { PoolFullError, UserPool } from './user-pool'
import { SessionTokenStore } from './web-host'
import { OidcClient, pkcePair } from './auth/oidc'
import { HeadlessPrinter, type PrintSession } from './print/headless-print'
import { IMAGE_MIME_BY_EXT } from '../main/ipc/file-ops'
import { forgejoProvider, probeAccess } from '../main/services/forge/forgejo.provider'

/** Extensions acceptées en upload : celles des sélecteurs du desktop (images, draw.io, classeur). */
const UPLOAD_EXTENSIONS = new Set([...Object.keys(IMAGE_MIME_BY_EXT), 'drawio', 'xlsx'])
const API_PREFIXES = ['/rpc/', '/auth/', '/events', '/upload', '/download/', '/healthz']

/** Vérification des accès des utilisateurs connectés (compte désactivé sans opération git). */
const ACCESS_CHECK_MS = 5 * 60_000

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Page minimale hors application (déconnexion, accès révoqué, connexion refusée). */
function infoPage(message: string, action: { href: string; label: string }): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<title>${escapeHtml(BRAND.productName)}</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
    `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></p></body></html>`
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    return !!host && new URL(origin).host === host
  } catch {
    return false
  }
}

export interface BuiltServer {
  app: FastifyInstance
  pool: UserPool
  sessions: SessionStore
  /** Vérification des accès des utilisateurs connectés (appelée toutes les 5 min en mode oidc). */
  checkAccesses(): Promise<void>
}

/**
 * GH44 — serveur web Polenta (specs/GH44-design.md §4) : sert le build web du renderer et relaie
 * ses appels `window.polenta.invoke/on` vers les handlers de l'utilisateur connecté.
 */
export async function buildServer(config: WebConfig, version: string): Promise<BuiltServer> {
  const app = Fastify({
    logger: { level: process.env['POLENTA_WEB_LOG_LEVEL'] ?? 'info' },
    bodyLimit: 50 * 1024 * 1024, // payloads d'export (lignes déjà chargées par la vue)
  })
  const sessions = new SessionStore(config.sessionHours * 3_600_000)
  const auth = config.auth
  const oidc = auth.mode === 'oidc'
    ? new OidcClient(auth.forgeUrl, auth.clientId, auth.clientSecret, `${auth.publicUrl}/auth/callback`)
    : null
  /** Forge de l'instance : celle des sessions (OIDC) ou du compte de développement. */
  const forgeUrl = auth.mode === 'oidc' ? auth.forgeUrl : new URL(auth.remote).origin
  const forgeHost = new URL(forgeUrl).hostname
  const pendingAuth = new PendingAuthorizations()

  /**
   * GH44 S4 — impression : un Chromium headless charge les routes `/print/*` depuis ce serveur
   * (adresse d'écoute, port réellement écouté), dans une session d'impression de l'utilisateur
   * (durée du rendu au plus, détruite après le rendu).
   */
  const printer = config.print ? new HeadlessPrinter(() => {
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : config.port
    return `http://${printHost(config.host)}:${port}`
  }) : null
  function openPrintSession(login: string, ttlMs: number): PrintSession {
    const session = sessions.createPrint({ login, name: 'impression', email: '' }, ttlMs)
    return {
      cookies: [
        { name: SESSION_COOKIE, value: app.signCookie(session.id) },
        { name: CSRF_COOKIE, value: session.csrf },
      ],
      dispose: () => sessions.destroy(session.id),
    }
  }

  const pool = new UserPool({
    dataDir: config.dataDir, resourcesDir: config.resourcesDir, idleMinutes: config.idleMinutes, version,
    machineConfig: config.machineConfig, maxActiveUsers: config.maxActiveUsers,
    ...(printer ? { createPrintRenderer: (login: string) => printer.forUser(ttlMs => openPrintSession(login, ttlMs)) } : {}),
    createTokenStore: (login) => new SessionTokenStore(
      oidc ? (refreshToken) => oidc.refresh(refreshToken) : undefined,
      () => revokeLogin(login, 'rafraîchissement du jeton refusé par la forge'),
    ),
  })

  /**
   * GH44 S3 — accès révoqué ou expiré (compte désactivé, jeton révoqué) : toutes les sessions de
   * l'utilisateur sont détruites, ses jetons effacés, ses vues prévenues puis redirigées. Ses
   * fichiers (modifications non publiées) restent dans son espace.
   */
  function revokeLogin(login: string, reason: string): void {
    const destroyed = sessions.destroyLogin(login)
    pool.revoke(login)
    app.log.warn({ login, sessions: destroyed, reason }, 'accès révoqué')
  }

  await app.register(fastifyCookie, { secret: config.sessionSecret })
  await app.register(fastifyMultipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } })
  await app.register(fastifyWebsocket)

  const cookieOpts = { path: '/', sameSite: 'lax' as const, secure: config.secureCookies }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof PoolFullError) {
      return reply.code(503).send({ ok: false, error: { message: err.message } })
    }
    const message = err instanceof Error ? err.message : String(err)
    req.log.error({ err: message }, 'erreur serveur')
    const status = (err as { statusCode?: number }).statusCode ?? 500
    return reply.code(status).send({ ok: false, error: { message: status < 500 ? message : 'Erreur interne du serveur.' } })
  })

  function startSession(reply: FastifyReply, identity: { login: string; name: string; email: string }): void {
    const session = sessions.create(identity)
    void reply
      .setCookie(SESSION_COOKIE, session.id, { ...cookieOpts, httpOnly: true, signed: true })
      .setCookie(CSRF_COOKIE, session.csrf, { ...cookieOpts, httpOnly: false })
  }

  function sessionId(req: FastifyRequest): string | undefined {
    const raw = req.cookies[SESSION_COOKIE]
    if (!raw) return undefined
    const unsigned = req.unsignCookie(raw)
    return unsigned.valid ? unsigned.value ?? undefined : undefined
  }

  function currentSession(req: FastifyRequest): Session | null {
    return sessions.get(sessionId(req))
  }

  /** Session requise ; pour une requête mutante, en-tête CSRF égal au cookie. */
  function requireSession(req: FastifyRequest, reply: FastifyReply, mutating: boolean): Session | null {
    const session = currentSession(req)
    if (!session) {
      void reply.code(401).send(sessions.wasRevoked(sessionId(req))
        ? { ok: false, error: { message: 'Votre accès a été révoqué ou a expiré, reconnectez-vous.', revoked: true } }
        : { ok: false, error: { message: 'Session expirée, reconnectez-vous.' } })
      return null
    }
    if (mutating && !csrfMatches(session.csrf, req.headers[CSRF_HEADER])) {
      void reply.code(403).send({ ok: false, error: { message: 'Requête refusée (CSRF).' } })
      return null
    }
    return session
  }

  // ── Santé ─────────────────────────────────────────────────────────────────────
  app.get('/healthz', async () => ({ ok: true, version }))

  // ── Authentification ───────────────────────────────────────────────────────────
  if (auth.mode === 'dev') {
    // Mode dev : un utilisateur fixe, jeton fourni par l'environnement (développement, tests e2e).
    app.get('/auth/login', async (_req, reply) => {
      const { login, name, email, remote, token } = auth
      const rt = await pool.get(login)
      const host = new URL(remote).hostname
      if (token) {
        const tokens = pool.tokenStore(login)
        await tokens.set(host, token)
        await tokens.set(`${host}:${login}`, token)
      }
      // Compte de la session dans auth.json de l'utilisateur : AuthService (auteur des commits,
      // identifiants HTTPS) fonctionne alors à l'identique du desktop.
      await rt.container.auth.saveAccount({ remoteHost: host, username: login, name, email })
      rt.container.auth.clearAccessRevoked(host)
      startSession(reply, { login, name, email })
      return reply.redirect('/')
    })
  } else {
    // OIDC (design §5.1, révisé §10.2) : Authorization Code + PKCE vers la forge de l'instance.
    app.get('/auth/login', async (req, reply) => {
      const { verifier, challenge } = pkcePair()
      const state = pendingAuth.create(verifier)
      let url: string
      try {
        url = await oidc!.authorizationUrl(state, challenge)
      } catch (err) {
        req.log.error({ err: String(err) }, 'découverte OIDC')
        return reply.code(503).type('text/html; charset=utf-8').send(infoPage(
          `Le serveur de connexion (${forgeHost}) est injoignable pour le moment. Réessayez dans quelques instants.`,
          { href: '/auth/login', label: 'Réessayer' }))
      }
      void reply.setCookie(OIDC_STATE_COOKIE, state, { ...cookieOpts, httpOnly: true, signed: true, maxAge: 600 })
      return reply.redirect(url)
    })

    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (req, reply) => {
      const retry = { href: '/auth/login', label: 'Se connecter' }
      void reply.clearCookie(OIDC_STATE_COOKIE, cookieOpts).type('text/html; charset=utf-8')
      if (req.query.error) {
        return reply.code(403).send(infoPage(`Connexion refusée par le serveur (${req.query.error}).`, retry))
      }
      const raw = req.cookies[OIDC_STATE_COOKIE]
      const cookieState = raw ? req.unsignCookie(raw) : null
      const state = req.query.state ?? ''
      const pending = cookieState?.valid && cookieState.value === state ? pendingAuth.take(state) : null
      if (!pending || !req.query.code) {
        return reply.code(400).send(infoPage('Connexion expirée ou lancée depuis un autre navigateur.', retry))
      }
      let tokens: Awaited<ReturnType<OidcClient['exchangeCode']>>
      let identity: Awaited<ReturnType<typeof forgejoProvider.resolveIdentity>>
      try {
        tokens = await oidc!.exchangeCode(req.query.code, pending.codeVerifier)
        // Identité lue par l'API de la forge avec le jeton obtenu (comme le desktop, #45).
        identity = await forgejoProvider.resolveIdentity(forgeUrl, tokens.accessToken)
      } catch (err) {
        req.log.warn({ err: String(err) }, 'connexion OIDC')
        return reply.code(502).send(infoPage(
          `La connexion n'a pas abouti : le serveur ${forgeHost} n'a pas confirmé votre identité. Réessayez ; si le problème persiste, contactez votre administrateur.`,
          retry))
      }
      const login = identity.login.toLowerCase()
      if (!LOGIN_PATTERN.test(login)) {
        return reply.code(403).send(infoPage(`Identifiant « ${identity.login} » non pris en charge par ${BRAND.productName} Web.`, retry))
      }
      try {
        const rt = await pool.get(login)
        pool.tokenStore(login).setOAuth(forgeHost, identity.login, tokens)
        // Compte forge dans l'espace de l'utilisateur, levée d'une révocation antérieure ; identité
        // déjà vérifiée ci-dessus avec ce jeton.
        await rt.container.auth.connectWithToken(forgeUrl, tokens.accessToken, 'forgejo', identity)
        // Configuration de l'équipe (#45 S2b), comme le desktop à la connexion.
        await rt.container.forgeConfig.refresh().catch(err => req.log.warn({ err: String(err) }, 'configuration d\'équipe'))
      } catch (err) {
        req.log.error({ err: String(err) }, 'ouverture de l\'espace utilisateur')
        return reply.code(err instanceof PoolFullError ? 503 : 500).send(infoPage(
          err instanceof PoolFullError ? err.message : 'Votre espace n\'a pas pu être ouvert. Réessayez dans quelques instants.',
          retry))
      }
      startSession(reply, { login, name: identity.name, email: identity.email })
      return reply.redirect('/')
    })
  }

  app.post('/auth/logout', async (req, reply) => {
    const session = requireSession(req, reply, true)
    if (!session) return reply
    sessions.destroy(session.id)
    if (!sessions.hasLogin(session.login)) pool.forgetCredentials(session.login)
    void reply.clearCookie(SESSION_COOKIE, cookieOpts).clearCookie(CSRF_COOKIE, cookieOpts)
    return { ok: true }
  })

  app.get('/auth/logged-out', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(infoPage('Vous êtes déconnecté.', { href: '/auth/login', label: 'Se reconnecter' })))

  app.get('/auth/revoked', async (_req, reply) => {
    void reply.clearCookie(SESSION_COOKIE, cookieOpts).clearCookie(CSRF_COOKIE, cookieOpts)
    return reply.type('text/html; charset=utf-8').send(infoPage(
      'Votre accès a été révoqué ou a expiré, reconnectez-vous. Vos modifications non publiées sont conservées.',
      { href: '/auth/login', label: 'Se reconnecter' }))
  })

  app.get('/auth/me', async (req, reply) => {
    const session = requireSession(req, reply, false)
    if (!session) return reply
    return { login: session.login, name: session.name, email: session.email, remote: forgeUrl }
  })

  // ── RPC : équivalent de ipcRenderer.invoke ────────────────────────────────────
  app.post<{ Params: { channel: string }; Body: { args?: unknown; undefinedArgs?: unknown } }>('/rpc/:channel', async (req, reply) => {
    const session = requireSession(req, reply, true)
    if (!session) return reply
    const { channel } = req.params
    if (!isExposed(channel)) return reply.code(404).send({ ok: false, error: { message: `Channel inconnu : ${channel}` } })

    const rt = await pool.get(session.login)
    const handler = rt.handlers.get(channel)
    if (!handler) return reply.code(404).send({ ok: false, error: { message: `Channel inconnu : ${channel}` } })

    const args: unknown[] = Array.isArray(req.body?.args) ? req.body.args : []
    // Positions des arguments `undefined` côté navigateur (perdus par JSON) : paramètres par défaut.
    if (Array.isArray(req.body?.undefinedArgs)) {
      for (const i of req.body.undefinedArgs) if (Number.isInteger(i) && i >= 0 && i < args.length) args[i] = undefined
    }
    try {
      await checkArgs(channel, args, rt.realRoot)
    } catch (err) {
      if (err instanceof PathGuardError) {
        req.log.warn({ login: session.login, channel, argIndex: err.argIndex, reason: err.reason }, 'path guard')
        return reply.code(403).send({ ok: false, error: { message: 'Accès refusé.' } })
      }
      throw err
    }

    rt.lastSeen = Date.now()
    // Génération des jetons au début de l'appel : une erreur venue de jetons remplacés depuis
    // (reconnexion pendant un long push) ne révoque pas la nouvelle connexion.
    const tokenStore = pool.tokenStore(session.login)
    const epoch = tokenStore.epoch
    const sameTokens = (): boolean => tokenStore.epoch === epoch
    /**
     * GH44 S3 — la forge de la session a été déclarée révoquée par le conteneur de l'utilisateur
     * (#45 : 401, compte désactivé détecté par la sonde, synchronisation automatique qui renvoie
     * `accessRevoked` sans lever d'erreur) : la session est invalidée, quel que soit le chemin.
     */
    const revokedDuringCall = (): boolean => {
      if (!oidc || !rt.container.auth.isAccessRevoked(forgeHost)) return false
      if (!sameTokens()) {
        // Marque posée par un appel parti avec les anciens jetons : la nouvelle connexion prévaut.
        rt.container.auth.clearAccessRevoked(forgeHost)
        return false
      }
      revokeLogin(session.login, `accès révoqué détecté (${channel})`)
      void reply.clearCookie(SESSION_COOKIE, cookieOpts).clearCookie(CSRF_COOKIE, cookieOpts)
      return true
    }
    rt.inflight++
    try {
      const value = await handler(null, ...args)
      if (revokedDuringCall()) {
        return reply.code(401).send({ ok: false, error: { message: 'Votre accès a été révoqué ou a expiré, reconnectez-vous.', revoked: true } })
      }
      return { ok: true, value }
    } catch (err) {
      // Comme l'IPC Electron : seul le message traverse, jamais la pile.
      const message = err instanceof Error ? err.message : String(err)
      req.log.info({ channel, err: message }, 'rpc error')
      // GH44 S3 — accès révoqué par la forge de la session (marqueur de #45) : session invalidée.
      const access = parseForgeAccessError(message)
      const forge401 = !!oidc && access?.issue.status === 401 && access.issue.host === forgeHost && sameTokens()
      if (revokedDuringCall() || forge401) {
        if (sessions.get(session.id)) revokeLogin(session.login, `401 de la forge (${channel})`)
        void reply.clearCookie(SESSION_COOKIE, cookieOpts).clearCookie(CSRF_COOKIE, cookieOpts)
        return reply.code(401).send({ ok: false, error: { message, revoked: true } })
      }
      return { ok: false, error: { message } }
    } finally {
      rt.inflight--
    }
  })

  // ── Événements poussés : équivalent de webContents.send ───────────────────────
  app.get('/events', { websocket: true }, async (socket, req) => {
    // Pas d'en-tête CSRF possible sur un WebSocket : l'Origin doit être celle du serveur
    // (une page d'un autre port/sous-domaine du même site enverrait le cookie SameSite=Lax).
    const origin = req.headers.origin
    if (origin && !sameHost(origin, req.headers.host)) {
      socket.close(4403, 'origin')
      return
    }
    const session = currentSession(req)
    if (!session) {
      // 4402 : session révoquée (page « accès révoqué ») ; 4401 : session absente (connexion).
      socket.close(sessions.wasRevoked(sessionId(req)) ? 4402 : 4401, 'session')
      return
    }
    // Écouteur posé avant l'attente : une socket fermée pendant la création du conteneur ne doit
    // pas rester comptée (elle empêcherait l'éviction).
    let closed = false
    let rt: Awaited<ReturnType<typeof pool.get>> | null = null
    socket.on('close', () => {
      closed = true
      if (rt) {
        rt.sockets.delete(socket)
        rt.lastSeen = Date.now()
      }
    })
    rt = await pool.get(session.login)
    if (closed) return
    // Révoquée ou terminée pendant la création du conteneur : pas de flux d'événements orphelin.
    if (!sessions.get(session.id)) {
      socket.close(sessions.wasRevoked(session.id) ? 4402 : 4401, 'session')
      return
    }
    rt.sockets.add(socket)
  })

  // ── Upload : remplace les dialogues d'ouverture de fichier ────────────────────
  app.post('/upload', async (req, reply) => {
    const session = requireSession(req, reply, true)
    if (!session) return reply
    const file = await req.file()
    if (!file) return reply.code(400).send({ ok: false, error: { message: 'Aucun fichier reçu.' } })
    const ext = path.extname(file.filename).toLowerCase().replace('.', '')
    if (!UPLOAD_EXTENSIONS.has(ext)) {
      file.file.resume()
      return reply.code(415).send({ ok: false, error: { message: `Type de fichier non accepté : .${ext}` } })
    }
    const rt = await pool.get(session.login)
    const target = await rt.uploads.create(file.filename)
    await pipeline(file.file, createWriteStream(target.filePath))
    if (file.file.truncated) {
      await rt.uploads.remove(target.id)
      return reply.code(413).send({ ok: false, error: { message: `Fichier trop volumineux (max ${config.maxUploadMb} Mo).` } })
    }
    return { ok: true, value: { uploadId: target.id, fileName: target.fileName } }
  })

  // ── Download : remplace « Enregistrer sous » ─────────────────────────────────
  app.get<{ Params: { id: string } }>('/download/:id', async (req, reply) => {
    const session = requireSession(req, reply, false)
    if (!session) return reply
    const rt = await pool.get(session.login)
    const file = await rt.downloads.resolve(req.params.id)
    if (!file) return reply.code(404).send({ ok: false, error: { message: 'Fichier introuvable ou expiré.' } })
    const stat = await fsP.stat(file.filePath)
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
    // RFC 5987 : `encodeURIComponent` laisse passer ' ( ) * qui ne sont pas des attr-char.
    const extended = encodeURIComponent(file.fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    void reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', stat.size)
      .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${extended}`)
    // Usage unique : supprimé une fois le fichier refermé — pas à la fin de la réponse, où le flux
    // de lecture peut encore le tenir ouvert (EPERM sous Windows, #50). Un échec n'est jamais une
    // rejection non gérée (elle arrêterait le process) : la purge horaire rattrape.
    const stream = createReadStream(file.filePath)
    stream.on('close', () => {
      rt.downloads.remove(req.params.id).catch(err => req.log.warn({ err: String(err) }, 'download non supprimé'))
    })
    return reply.send(stream)
  })

  // ── Build web du renderer ─────────────────────────────────────────────────────
  if (config.staticDir && existsSync(path.join(config.staticDir, 'web.html'))) {
    await app.register(fastifyStatic, { root: config.staticDir, index: false, wildcard: true })
    // `/` est un répertoire pour @fastify/static (403 sans index) : servi explicitement.
    app.get('/', (_req, reply) => reply.sendFile('web.html'))
    app.setNotFoundHandler((req, reply) => {
      // Fallback SPA pour les navigations seulement (`/dashboard?…`) : un fichier absent (extension
      // dans le chemin : script, image) répond 404 — renvoyer `web.html` à un <script> provoque une
      // erreur de syntaxe dans la page (viewer draw.io hors réseau, images relatives).
      const pathOnly = req.url.split('?')[0]
      if (req.method === 'GET' && !API_PREFIXES.some(p => req.url.startsWith(p)) && !/\.[a-z0-9]+$/i.test(pathOnly)) {
        return reply.sendFile('web.html')
      }
      return reply.code(404).send({ ok: false, error: { message: 'Introuvable' } })
    })
  }

  const evictTimer = setInterval(() => {
    const evicted = pool.evictIdle()
    if (evicted.length) app.log.info({ evicted }, 'utilisateurs inactifs libérés')
    void pool.purgeTempFiles()
  }, 60_000)
  evictTimer.unref()
  // Compte désactivé alors que l'utilisateur ne fait aucune opération git : vérification périodique
  // (rafraîchissement du jeton au besoin, puis `GET /api/v1/user`).
  const accessTimer = oidc ? setInterval(() => { void checkAccesses() }, ACCESS_CHECK_MS) : null
  accessTimer?.unref()
  let checking = false
  async function checkAccesses(): Promise<void> {
    if (checking) return // passe précédente encore en cours (forge lente)
    checking = true
    try {
      await Promise.allSettled(sessions.activeLogins().map(async (login) => {
        const store = pool.tokenStore(login)
        if (!store.hasOAuth()) return
        const epoch = store.epoch
        try {
          const verdict = await probeAccess(forgeUrl, await store.freshAccessToken())
          if (verdict === 'revoked' && store.epoch === epoch) revokeLogin(login, 'vérification périodique')
        } catch {
          // Rafraîchissement refusé : déjà révoqué par le magasin de jetons.
        }
      }))
    } finally {
      checking = false
    }
  }

  app.addHook('onClose', async () => {
    await printer?.close()
    if (accessTimer) clearInterval(accessTimer)
    clearInterval(evictTimer)
    pool.disposeAll()
  })

  return { app, pool, sessions, checkAccesses }
}

/**
 * GH44 S4 — adresse à laquelle le navigateur d'impression joint ce serveur : la boucle locale si le
 * serveur écoute sur toutes les interfaces, sinon l'adresse d'écoute elle-même.
 */
export function printHost(host: string): string {
  if (host === '0.0.0.0' || host === '') return '127.0.0.1'
  if (host === '::') return '[::1]'
  return host.includes(':') ? `[${host}]` : host
}
