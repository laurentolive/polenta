import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { QueryDefinition, QueryResult, SavedQuery } from '@polenta/types'

/** Options de la requête react-query exécutant une `SavedQuery` — extrait de `useQueryResult` pour
 *  être réutilisé tel quel par `print.dashboard.tsx` (T43 sprint 3), qui a besoin de connaître la
 *  fin de chargement de *tous* les widgets d'un dashboard (via `useQueries`) avant de signaler
 *  `notifyPrintReady()` — même `queryKey` ici que dans `DashboardGrid`, donc react-query
 *  dédoublonne l'appel IPC plutôt que de l'exécuter deux fois. */
export function widgetQueryOptions(repoPath: string, workspaceDir: string, query: SavedQuery | undefined | null) {
  return {
    queryKey: ['widget-query-result', repoPath, query?.id, query?.sqlText, JSON.stringify(query?.builderConfig ?? null)],
    queryFn: (): Promise<QueryResult> => {
      const def: QueryDefinition =
        query!.mode === 'sql' ? { mode: 'sql', sqlText: query!.sqlText } : { mode: 'builder', builderConfig: query!.builderConfig }
      return api.queries.execute(repoPath, def, workspaceDir)
    },
    enabled: !!repoPath && !!query,
  }
}

/**
 * Executes a SavedQuery and returns its QueryResult — shared by DashboardGrid (each
 * widget card runs its own query) and WidgetConfigModal (live preview), T77 sprint 2.
 * `query` may be undefined/null (widget's query deleted, or none picked yet in the
 * config modal) — the hook simply stays disabled rather than erroring.
 */
export function useQueryResult(repoPath: string, workspaceDir: string, query: SavedQuery | undefined | null) {
  return useQuery<QueryResult>(widgetQueryOptions(repoPath, workspaceDir, query))
}
