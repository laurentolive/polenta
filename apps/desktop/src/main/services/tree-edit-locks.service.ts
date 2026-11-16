import { randomUUID } from 'crypto'
import { TREE_LOCK_RENEW_MS, TREE_LOCK_TTL_MS } from '@polenta/types'
import { removeAppLock, waitForWriteLock, writeAppLock } from './tree-lock.util'

/**
 * GH361 — verrou long de l'application sur un rangement (`.polenta/trees/<nœud>/<type>.yaml`) :
 * tant qu'une vue l'affiche en édition, le serveur MCP n'y écrit pas (`TREE_LOCKED`).
 * specs/GH361-design.md §3.1.
 *
 * Chaque vue tient un bail (`acquire` → `renew` toutes les 10 s → `release`). Le fichier de verrou
 * de l'arbre (un par processus, `tree-lock.util.ts`) existe tant qu'il reste un bail sur cet arbre ;
 * son échéance est la plus lointaine des baux. Un renderer disparu cesse de renouveler : son bail
 * est purgé à échéance. Un processus mort n'a pas besoin de libérer : son PID suffit à rendre le
 * verrou caduc côté MCP.
 */

interface Lease { repoPath: string; nodeId: string; typeId: string; expiresAt: number }

export class TreeEditLocksService {
  private readonly leases = new Map<string, Lease>()
  /** Début du verrou de chaque arbre (clé `repo\0nœud\0type`), conservé tant qu'il reste un bail. */
  private readonly since = new Map<string, string>()
  private readonly pruneTimer: ReturnType<typeof setInterval>
  /** Écritures de fichier d'un même arbre sérialisées : un `release` ne passe pas devant un `acquire`. */
  private readonly queues = new Map<string, Promise<void>>()
  /** Détenteur des fichiers de cette instance (le serveur web a un conteneur par utilisateur). */
  private readonly owner = randomUUID()

  constructor(private readonly now: () => number = Date.now) {
    // Une erreur de fichier (EBUSY, EPERM…) ne doit jamais devenir un rejet non géré, qui arrêterait
    // le processus (serveur web compris).
    this.pruneTimer = setInterval(() => {
      this.prune().catch(err => console.error('[TreeEditLocks] purge des baux :', err))
    }, TREE_LOCK_RENEW_MS)
    this.pruneTimer.unref?.()
  }

  /** Prend un bail ; rend la main une fois l'éventuelle écriture MCP en cours terminée. */
  async acquire(repoPath: string, nodeId: string, typeId: string): Promise<string> {
    const id = randomUUID()
    this.leases.set(id, { repoPath, nodeId, typeId, expiresAt: this.now() + TREE_LOCK_TTL_MS })
    try {
      await this.sync(repoPath, nodeId, typeId)
      await waitForWriteLock(repoPath, nodeId, typeId)
    } catch (err) {
      // Bail jamais rendu au renderer : il ne doit pas survivre à l'échec.
      this.leases.delete(id)
      await this.sync(repoPath, nodeId, typeId).catch(() => {})
      throw err
    }
    return id
  }

  /** Prolonge un bail ; `false` s'il n'existe plus (purgé) : le renderer doit en reprendre un. */
  async renew(id: string): Promise<boolean> {
    const lease = this.leases.get(id)
    if (!lease) return false
    lease.expiresAt = this.now() + TREE_LOCK_TTL_MS
    await this.sync(lease.repoPath, lease.nodeId, lease.typeId)
    return true
  }

  async release(id: string): Promise<void> {
    const lease = this.leases.get(id)
    if (!lease) return
    this.leases.delete(id)
    await this.sync(lease.repoPath, lease.nodeId, lease.typeId)
  }

  /** Retire tous les baux et leurs fichiers (arrêt, tests). */
  async releaseAll(): Promise<void> {
    clearInterval(this.pruneTimer)
    const trees = [...this.leases.values()]
    this.leases.clear()
    for (const t of trees) await this.sync(t.repoPath, t.nodeId, t.typeId)
  }

  /** Purge les baux échus (renderer planté, onglet du navigateur fermé). */
  async prune(): Promise<void> {
    const now = this.now()
    const expired = [...this.leases].filter(([, l]) => l.expiresAt <= now)
    for (const [id] of expired) this.leases.delete(id)
    for (const [, l] of expired) await this.sync(l.repoPath, l.nodeId, l.typeId)
  }

  /** Met le fichier de verrou de l'arbre en accord avec ses baux. */
  private sync(repoPath: string, nodeId: string, typeId: string): Promise<void> {
    const key = `${repoPath}\0${nodeId}\0${typeId}`
    const run = async () => {
      const mine = [...this.leases.values()].filter(l => l.repoPath === repoPath && l.nodeId === nodeId && l.typeId === typeId)
      if (mine.length === 0) {
        this.since.delete(key)
        await removeAppLock(repoPath, nodeId, typeId, this.owner)
        return
      }
      if (!this.since.has(key)) this.since.set(key, new Date(this.now()).toISOString())
      const expiresAt = new Date(Math.max(...mine.map(l => l.expiresAt))).toISOString()
      await writeAppLock(repoPath, nodeId, typeId, this.since.get(key)!, expiresAt, this.owner)
    }
    const next = (this.queues.get(key) ?? Promise.resolve()).then(run, run)
    this.queues.set(key, next.catch(() => {}))
    return next
  }
}
