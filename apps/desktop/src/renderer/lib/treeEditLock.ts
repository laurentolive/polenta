/** Renouvellement du bail (le main le purge à 30 s sans renouvellement). */
export const TREE_LOCK_RENEW_MS = 10_000

export interface TreeLockApi {
  lock(repoPath: string, nodeId: string, typeId: string): Promise<string>
  renewLock(leaseId: string): Promise<boolean>
  unlock(leaseId: string): Promise<void>
}

/**
 * GH361 — tient le verrou d'édition d'un rangement jusqu'à l'appel de la fonction renvoyée : prise
 * immédiate, renouvellement toutes les 10 s (bail purgé ou prise échouée → nouvelle prise),
 * libération à l'arrêt (y compris d'une prise encore en cours). `onAcquired` à chaque prise.
 */
export function holdTreeEditLock(
  api: TreeLockApi, repoPath: string, nodeId: string, typeId: string, onAcquired: () => void,
): () => void {
  let stopped = false
  let lease: string | null = null
  let acquiring = false

  const acquire = async () => {
    if (acquiring) return
    acquiring = true
    try {
      const id = await api.lock(repoPath, nodeId, typeId)
      if (stopped) {
        void api.unlock(id).catch(() => {})
        return
      }
      lease = id
      onAcquired()
    } catch (err) {
      console.error('[treeEditLock] verrou du rangement non pris :', err)
    } finally {
      acquiring = false
    }
  }

  void acquire()
  const timer = setInterval(() => {
    if (!lease) {
      void acquire()
      return
    }
    const current = lease
    void api.renewLock(current).catch(() => false).then(ok => {
      if (ok || stopped || lease !== current) return
      lease = null
      void acquire()
    })
  }, TREE_LOCK_RENEW_MS)

  return () => {
    stopped = true
    clearInterval(timer)
    if (lease) void api.unlock(lease).catch(() => {})
    lease = null
  }
}
