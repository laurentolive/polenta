import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Subscribes to `repo:file-changed`, pushed by the main process (RepoWatcherService, via
 * `registerIpcHandlers`) whenever a watched repo changes out-of-band — an external edit, a
 * `git checkout`/`pull`, a bulk-import script writing directly to disk (as in the
 * exigences_320AW_RP1.yaml import). Without this, those changes only became visible after a
 * full app restart: schema.yaml's own cache got a manual "Actualiser" button fix earlier, but
 * the tree/objects/requirement/test caches populated by SystemView had no equivalent at all.
 *
 * Every affected query key consistently places `repoPath` at index 1 (`['schema', repoPath]`,
 * `['tree', repoPath, nodeId, typeId]`, `['objects', repoPath, category, nodeId, typeId]`,
 * `['requirement', repoPath, id]`, `['requirements-all', repoPath]`, …) — relied on below for
 * the `'*'` full-refresh case, where a ref change (checkout/pull/merge) gives no per-file
 * signal to narrow down.
 */
export function useLiveFileSync(): void {
  const qc = useQueryClient()

  useEffect(() => {
    const unsubscribe = window.polenta.on('repo:file-changed', (...args: unknown[]) => {
      const [repoPath, relPath] = args as [string, string]

      if (relPath === '*') {
        qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === repoPath })
        return
      }

      if (relPath === '.polenta/schema.yaml') {
        qc.invalidateQueries({ queryKey: ['schema', repoPath] })
        return
      }

      const treeMatch = /^\.polenta\/trees\/([^/]+)\/([^/]+)\.yaml$/.exec(relPath)
      if (treeMatch) {
        const [, nodeId, typeId] = treeMatch
        qc.invalidateQueries({ queryKey: ['tree', repoPath, nodeId, typeId] })
        qc.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === 'objects' && q.queryKey[1] === repoPath &&
            q.queryKey[3] === nodeId && q.queryKey[4] === typeId,
        })
        return
      }

      const objectMatch = /^(requirements|tests|campaigns)\/([^/]+)\.yaml$/.exec(relPath)
      if (objectMatch) {
        const [, dir, id] = objectMatch
        const category = dir === 'requirements' ? 'requirement' : dir === 'tests' ? 'test' : 'campaign'
        const singularKey = category
        const allKey = dir === 'requirements' ? 'requirements-all' : dir === 'tests' ? 'tests-all' : 'campaigns'
        qc.invalidateQueries({ queryKey: [singularKey, repoPath, id] })
        qc.invalidateQueries({ queryKey: [allKey, repoPath] })
        qc.invalidateQueries({
          predicate: (q) => q.queryKey[0] === 'objects' && q.queryKey[1] === repoPath && q.queryKey[2] === category,
        })
      }
    })
    return unsubscribe
  }, [qc])
}
