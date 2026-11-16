import { useEffect, useRef } from 'react'
import { api } from '../api'
import { holdTreeEditLock } from '../lib/treeEditLock'

/**
 * GH361 — tient le verrou d'édition du rangement affiché (`api.tree.lock`) : tant qu'il est tenu,
 * le serveur MCP n'écrit pas ce rangement (`TREE_LOCKED`). Pris quand `enabled`, rendu au changement
 * de cible, quand `enabled` repasse à faux et au démontage (`holdTreeEditLock`). `onAcquired` est
 * appelé à chaque prise : relire l'arbre, qu'un agent a pu ranger pendant qu'il n'était pas
 * verrouillé. specs/GH361-design.md §3.3.
 */
export function useTreeEditLock(opts: {
  repoPath: string
  nodeId: string
  typeId: string
  enabled: boolean
  onAcquired?: () => void | Promise<void>
}): void {
  const { repoPath, nodeId, typeId, enabled } = opts
  const onAcquiredRef = useRef(opts.onAcquired)
  useEffect(() => { onAcquiredRef.current = opts.onAcquired }, [opts.onAcquired])

  useEffect(() => {
    if (!enabled || !repoPath || !nodeId || !typeId) return
    return holdTreeEditLock(api.tree, repoPath, nodeId, typeId, () => {
      void Promise.resolve(onAcquiredRef.current?.()).catch(err => console.error('[useTreeEditLock] relecture :', err))
    })
  }, [enabled, repoPath, nodeId, typeId])
}
