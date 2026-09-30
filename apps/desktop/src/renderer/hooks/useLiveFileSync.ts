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
const DASHBOARD_KEYS = ['dashboards', 'dashboard', 'print-dashboard']

export function useLiveFileSync(): void {
  const qc = useQueryClient()

  useEffect(() => {
    const unsubscribe = window.polenta.on('repo:file-changed', (...args: unknown[]) => {
      const [repoPath, relPath] = args as [string, string]

      // T175 — l'analyse locale couvre tout le workspace (clé indexée sur le repo racine) : tout
      // changement d'élément/lien ou de ref dans n'importe quel repo la rend périmée.
      if (relPath === '*' || /^(requirements|tests|links)\//.test(relPath)) {
        qc.invalidateQueries({ queryKey: ['impact-analysis:local'] })
        // T173 — éléments marqués du workspace (même périmètre).
        qc.invalidateQueries({ queryKey: ['revalidation:flagged'] })
      }

      if (relPath === '*') {
        qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === repoPath })
        return
      }

      if (relPath === '.polenta/schema.yaml') {
        qc.invalidateQueries({ queryKey: ['schema', repoPath] })
        return
      }

      // GH18 — vue Suivi : requêtes/dashboards partagés écrits hors de l'app (tools MCP).
      // Clés `[<clé>, repoPath, username, …]` — match par préfixe, tout user. `dashboard` /
      // `print-dashboard` = dashboard ouvert (widgets), pas seulement la liste.
      if (relPath.startsWith('queries/')) {
        qc.invalidateQueries({ queryKey: ['queries', repoPath] })
        return
      }
      if (relPath.startsWith('dashboards/')) {
        for (const key of DASHBOARD_KEYS) qc.invalidateQueries({ queryKey: [key, repoPath] })
        return
      }
      // Requêtes/dashboards privés et ordres du panneau latéral vivent dans `.{user}.pref`.
      if (/^\.[^/]+\.pref$/.test(relPath)) {
        for (const key of ['queries', 'queries-order', 'dashboards-order', ...DASHBOARD_KEYS]) {
          qc.invalidateQueries({ queryKey: [key, repoPath] })
        }
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
