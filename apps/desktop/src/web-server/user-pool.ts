import type { MachineConfig } from '@polenta/types'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { createContainer } from '../main/container'
import { registerHandlers, type Container } from '../main/ipc/index'
import type { Handler } from '../main/ipc/registry'
import { FileStore } from './file-store'
import { createWebHostContext, createWebPlatformHost, pendingPrintRenderer, MemoryTokenStore } from './web-host'
import { registerWebHandlers, type UserDirs } from './web-handlers'

export interface EventSocket {
  send(data: string): void
}

/** Ressources d'un utilisateur connecté : ses services, ses handlers, ses vues ouvertes. */
export interface UserRuntime {
  login: string
  /** Racine de l'utilisateur, liens symboliques résolus (garde de chemins). */
  realRoot: string
  dirs: UserDirs
  container: Container
  handlers: Map<string, Handler>
  sockets: Set<EventSocket>
  uploads: FileStore
  downloads: FileStore
  lastSeen: number
}

export interface UserPoolOptions {
  /** GH45 — configuration machine de l'exploitant (forge par défaut, démo…). */
  machineConfig: MachineConfig
  dataDir: string
  resourcesDir: string
  idleMinutes: number
  version: string
}

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const DOWNLOAD_TTL_MS = 60 * 60 * 1000

/**
 * GH44 — un conteneur de services complet par utilisateur, créé à la demande et libéré après
 * inactivité (specs/GH44-design.md D5, §5.3). Les jetons forge vivent dans `credentials`, qui
 * survit à l'éviction : seul un logout (ou un redémarrage) les efface.
 */
export class UserPool {
  private readonly runtimes = new Map<string, UserRuntime>()
  private readonly pending = new Map<string, Promise<UserRuntime>>()
  private readonly credentials = new Map<string, MemoryTokenStore>()

  constructor(private readonly opts: UserPoolOptions) {}

  tokenStore(login: string): MemoryTokenStore {
    let store = this.credentials.get(login)
    if (!store) {
      store = new MemoryTokenStore()
      this.credentials.set(login, store)
    }
    return store
  }

  /** Logout : vide le magasin en place — le conteneur de l'utilisateur garde la même instance. */
  forgetCredentials(login: string): void {
    this.credentials.get(login)?.clear()
  }

  peek(login: string): UserRuntime | undefined {
    return this.runtimes.get(login)
  }

  /** Création sérialisée par login : deux requêtes simultanées partagent le même conteneur. */
  async get(login: string): Promise<UserRuntime> {
    const existing = this.runtimes.get(login)
    if (existing) {
      existing.lastSeen = Date.now()
      return existing
    }
    let pending = this.pending.get(login)
    if (!pending) {
      pending = this.create(login).finally(() => this.pending.delete(login))
      this.pending.set(login, pending)
    }
    return pending
  }

  private async create(login: string): Promise<UserRuntime> {
    const root = path.join(this.opts.dataDir, 'users', login)
    const dirs: UserDirs = {
      root,
      workspaces: path.join(root, 'workspaces'),
      userData: path.join(root, 'userData'),
    }
    await fsP.mkdir(dirs.workspaces, { recursive: true })
    await fsP.mkdir(dirs.userData, { recursive: true })
    const realRoot = await fsP.realpath(root)

    const sockets = new Set<EventSocket>()
    const broadcast = (channel: string, ...args: unknown[]) => {
      const message = JSON.stringify({ channel, args })
      for (const socket of sockets) {
        try { socket.send(message) } catch { /* socket fermée entre-temps */ }
      }
    }
    const container = createContainer(createWebHostContext(dirs.userData, this.tokenStore(login), this.opts.machineConfig), pendingPrintRenderer)
    // Pas de dossier local à choisir : la bibliothèque de gabarits d'export (GH34) vit dans l'espace
    // de l'utilisateur.
    if (!container.appSettings.get().exportTemplatesDir) {
      container.appSettings.set({ exportTemplatesDir: path.join(dirs.userData, 'export-templates') })
    }

    const handlers = new Map<string, Handler>()
    const registry = { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn) } }
    registerHandlers(registry, container, createWebPlatformHost(
      broadcast, path.join(this.opts.resourcesDir, 'export-templates'),
    ))
    const uploads = new FileStore(path.join(dirs.userData, 'uploads'), UPLOAD_TTL_MS)
    const downloads = new FileStore(path.join(dirs.userData, 'downloads'), DOWNLOAD_TTL_MS)
    registerWebHandlers(registry, { container, dirs, uploads, downloads, version: this.opts.version })

    const runtime: UserRuntime = {
      login, realRoot, dirs, container, handlers, sockets, uploads, downloads, lastSeen: Date.now(),
    }
    this.runtimes.set(login, runtime)
    void uploads.purge()
    void downloads.purge()
    return runtime
  }

  /** Purge les fichiers temporaires expirés (uploads 24 h, téléchargements 1 h) des utilisateurs actifs. */
  async purgeTempFiles(): Promise<void> {
    for (const rt of this.runtimes.values()) {
      await rt.uploads.purge()
      await rt.downloads.purge()
    }
  }

  /** Libère les utilisateurs inactifs sans vue ouverte. Les fichiers ne sont jamais touchés. */
  evictIdle(now = Date.now()): string[] {
    const limit = this.opts.idleMinutes * 60_000
    const evicted: string[] = []
    for (const [login, rt] of this.runtimes) {
      if (rt.sockets.size === 0 && now - rt.lastSeen > limit) {
        this.dispose(rt)
        evicted.push(login)
      }
    }
    return evicted
  }

  private dispose(rt: UserRuntime): void {
    rt.container.watcher.unwatchAll()
    this.runtimes.delete(rt.login)
  }

  disposeAll(): void {
    for (const rt of [...this.runtimes.values()]) this.dispose(rt)
  }
}
