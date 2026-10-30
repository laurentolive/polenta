import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EVENTS_RECONNECTED } from '../lib/webEvents'
import { WORKSPACE_LINK_QUERY_KEYS } from './useWorkspaceLinks'

/**
 * Subscribes to `repo:file-changed`, pushed by the main process (RepoWatcherService, via
 * `registerHandlers`) whenever a watched repo changes out-of-band — an external edit, a
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
const DASHBOARD_KEYS = ['dashboards', 'dashboard', 'print-dashboard', 'suivi-updates']

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

      // GH105 — objets, liens et types de lien agrégés sur le workspace (clés indexées sur le repo
      // racine) : tout changement d'élément, de lien, de schéma ou de la liste des composants,
      // dans n'importe quel repo, les rend périmés.
      if (relPath === '*' || relPath === '.polenta/schema.yaml' || relPath === 'polenta-repo.yaml'
        || /^(requirements|tests|links)\//.test(relPath)) {
        for (const key of WORKSPACE_LINK_QUERY_KEYS) qc.invalidateQueries({ queryKey: [key] })
        // Couverture calculée sur tout le workspace (clé indexée sur le repo affiché).
        qc.invalidateQueries({ queryKey: ['traceability-matrix'] })
      }

      // GH65 / GH74 — résultats des widgets de la vue Suivi : clé indexée sur le repo RACINE, mais le
      // graphe agrège tout le workspace. Un changement de données (exécutions comprises), de ref
      // (avance rapide du pull automatique), de la bibliothèque projet ou d'un script de requête
      // (écrit hors de l'app, MCP) dans n'importe quel repo les rend périmés.
      if (relPath === '*' || /^(requirements|tests|test-runs|links|campaigns|changes|queries|dashboards\/lib)\//.test(relPath)) {
        qc.invalidateQueries({ queryKey: ['widget-query-result'] })
        qc.invalidateQueries({ queryKey: ['widget-drilldown'] }) // popup de détail ouverte (même dataset)
      }
      // GH197 — historique des exécutions : runs, campagnes, tests et liens (couverture d'une exigence).
      if (relPath === '*' || /^(tests|test-runs|links|campaigns)\//.test(relPath)) {
        qc.invalidateQueries({ queryKey: ['execution-history'] })
      }
      // Runs d'un test (consultation d'un run) : sans cela, un run écrit ailleurs restait introuvable
      // dans la liste en cache (« Non exécuté ») jusqu'au prochain rechargement.
      if (relPath === '*' || relPath.startsWith('test-runs/')) qc.invalidateQueries({ queryKey: ['test-runs'] })
      // GH74 — bandeau des mises à jour : requêtes des seeds (versions de modèle).
      if (relPath.startsWith('queries/')) qc.invalidateQueries({ queryKey: ['suivi-updates'] })

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

      // GH198 — changes : liste du panneau (workspace) et page du change.
      const changeMatch = /^changes\/([^/]+)\.yaml$/.exec(relPath)
      if (relPath === '*' || changeMatch) qc.invalidateQueries({ queryKey: ['changes'] })
      // GH199 — analyse d'impact d'un change : recalculée sur un changement d'élément, de lien ou de change.
      if (relPath === '*' || /^(requirements|tests|links|changes)\//.test(relPath)) qc.invalidateQueries({ queryKey: ['change-analysis'] })
      // GH199 §8bis — backlog : statut d'un élément ou assignation dans un change.
      if (relPath === '*' || /^(requirements|tests|changes)\//.test(relPath)) qc.invalidateQueries({ queryKey: ['changes-backlog'] })
      if (changeMatch) qc.invalidateQueries({ queryKey: ['change', repoPath, changeMatch[1]] })

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
    // GH44 — version web : connexion d'événements rétablie après une coupure, des changements ont
    // pu être manqués → tout relire (jamais émis sur le desktop).
    const unsubscribeReconnect = window.polenta.on(EVENTS_RECONNECTED, () => { void qc.invalidateQueries() })
    return () => {
      unsubscribe()
      unsubscribeReconnect()
    }
  }, [qc])
}
