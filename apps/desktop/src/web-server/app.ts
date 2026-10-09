import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import * as fsP from 'fs/promises'
import { pipeline } from 'stream/promises'
import * as path from 'path'
import type { WebConfig } from './config'
import { isExposed } from './channel-policy'
import { checkArgs, PathGuardError } from './path-guard'
import { SessionStore, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, csrfMatches, type Session } from './session'
import { UserPool } from './user-pool'
import { IMAGE_MIME_BY_EXT } from '../main/ipc/file-ops'

/** Extensions acceptées en upload : celles des sélecteurs du desktop (images, draw.io, classeur). */
const UPLOAD_EXTENSIONS = new Set([...Object.keys(IMAGE_MIME_BY_EXT), 'drawio', 'xlsx'])
const API_PREFIXES = ['/rpc/', '/auth/', '/events', '/upload', '/download/', '/healthz']

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
  const pool = new UserPool({
    dataDir: config.dataDir, resourcesDir: config.resourcesDir, idleMinutes: config.idleMinutes, version,
  })

  await app.register(fastifyCookie, { secret: config.sessionSecret })
  await app.register(fastifyMultipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } })
  await app.register(fastifyWebsocket)

  const cookieOpts = { path: '/', sameSite: 'lax' as const, secure: config.secureCookies }

  function currentSession(req: FastifyRequest): Session | null {
    const raw = req.cookies[SESSION_COOKIE]
    if (!raw) return null
    const unsigned = req.unsignCookie(raw)
    return unsigned.valid ? sessions.get(unsigned.value ?? undefined) : null
  }

  /** Session requise ; pour une requête mutante, en-tête CSRF égal au cookie. */
  function requireSession(req: FastifyRequest, reply: FastifyReply, mutating: boolean): Session | null {
    const session = currentSession(req)
    if (!session) {
      void reply.code(401).send({ ok: false, error: { message: 'Session expirée, reconnectez-vous.' } })
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

  // ── Authentification (sprint 2 : mode dev, un utilisateur fixe) ──────────────
  app.get('/auth/login', async (_req, reply) => {
    const { login, name, email, remote, token } = config.auth
    const session = sessions.create({ login, name, email })
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
    void reply
      .setCookie(SESSION_COOKIE, session.id, { ...cookieOpts, httpOnly: true, signed: true })
      .setCookie(CSRF_COOKIE, session.csrf, { ...cookieOpts, httpOnly: false })
    return reply.redirect('/')
  })

  app.get('/auth/logout', async (req, reply) => {
    const session = currentSession(req)
    if (session) {
      sessions.destroy(session.id)
      if (!sessions.hasLogin(session.login)) pool.forgetCredentials(session.login)
    }
    void reply.clearCookie(SESSION_COOKIE, cookieOpts).clearCookie(CSRF_COOKIE, cookieOpts)
    return reply.type('text/html; charset=utf-8').send(
      '<!doctype html><meta charset="utf-8"><title>Polenta</title>' +
      '<body style="font-family:sans-serif;padding:2rem">Vous êtes déconnecté. ' +
      '<a href="/auth/login">Se reconnecter</a></body>',
    )
  })

  app.get('/auth/me', async (req, reply) => {
    const session = requireSession(req, reply, false)
    if (!session) return reply
    return { login: session.login, name: session.name, email: session.email, remote: config.auth.remote }
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
    try {
      const value = await handler(null, ...args)
      return { ok: true, value }
    } catch (err) {
      // Comme l'IPC Electron : seul le message traverse, jamais la pile.
      req.log.info({ channel, err: err instanceof Error ? err.message : String(err) }, 'rpc error')
      return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }
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
      socket.close(4401, 'session')
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
    if (!closed) rt.sockets.add(socket)
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
    // Usage unique : supprimé une fois envoyé (la purge horaire couvre un téléchargement abandonné).
    reply.raw.on('finish', () => { void rt.downloads.remove(req.params.id) })
    return reply.send(createReadStream(file.filePath))
  })

  // ── Build web du renderer ─────────────────────────────────────────────────────
  if (config.staticDir && existsSync(path.join(config.staticDir, 'web.html'))) {
    await app.register(fastifyStatic, { root: config.staticDir, index: false, wildcard: true })
    // `/` est un répertoire pour @fastify/static (403 sans index) : servi explicitement.
    app.get('/', (_req, reply) => reply.sendFile('web.html'))
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !API_PREFIXES.some(p => req.url.startsWith(p))) {
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
  app.addHook('onClose', async () => {
    clearInterval(evictTimer)
    pool.disposeAll()
  })

  return { app, pool, sessions }
}
