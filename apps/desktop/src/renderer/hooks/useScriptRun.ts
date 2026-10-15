import { useQuery } from '@tanstack/react-query'
import type { GraphParamValue, QueryResult, ScriptClientInfo, ScriptError, ScriptRunRequest, ScriptRunResult, Widget } from '@polenta/types'
import { api } from '../api'
import i18n from '../i18n'

/**
 * GH74 — exécution des scripts de la vue Suivi (bac à sable du main). Clés `['widget-query-result', …]`
 * invalidées par `useLiveFileSync` sur tout changement de données (ou de `dashboards/lib/`) dans
 * n'importe quel repo du workspace.
 */

/** Langue et fuseau de l'utilisateur, transmis à chaque exécution (le serveur web ne les connaît pas). */
export function clientInfo(): ScriptClientInfo {
  return { locale: i18n.resolvedLanguage ?? i18n.language ?? 'fr', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
}

/** Résultat réussi au format des exports (`_ids` conservé dans les lignes). */
export function toQueryResult(run: ScriptRunResult): QueryResult | null {
  return run.ok ? { columns: run.columns, rows: run.rows } : null
}

/** Erreur d'exécution d'un script : message lisible, avec fichier et ligne quand ils sont connus. */
export function scriptErrorText(error: ScriptError): string {
  const where = error.file ? ` (${error.file}${error.line ? `:${error.line}` : ''})` : ''
  return `${error.message}${where}`
}

export function runOptions(repoPath: string, workspaceDir: string, username: string, req: ScriptRunRequest, enabled = true) {
  return {
    queryKey: ['widget-query-result', repoPath, workspaceDir, username, JSON.stringify(req)],
    queryFn: (): Promise<ScriptRunResult> => api.suivi.run(repoPath, workspaceDir, username, req, clientInfo()),
    enabled: enabled && !!repoPath && !!username,
  }
}

/** Requête d'un widget enregistré (requête + transformation lues côté main). Le script de la requête
 *  et la transformation font partie de la clé : un widget ou une requête modifiés sont réexécutés.
 *  GH93 : les valeurs des paramètres de sa requête aussi (seuls les widgets concernés par un
 *  changement de valeur sont relancés). */
export function widgetRunOptions(
  repoPath: string, workspaceDir: string, username: string, dashboardId: string, widget: Widget, queryScript: string | undefined,
  params: Record<string, GraphParamValue> = {}, enabled = true,
) {
  return {
    ...runOptions(repoPath, workspaceDir, username, { dashboardId, widgetId: widget.id, params }, enabled),
    queryKey: ['widget-query-result', repoPath, workspaceDir, username, dashboardId, widget.id, widget.queryId, queryScript ?? null, widget.transform ?? null, JSON.stringify(params)],
  }
}

export function useScriptRun(repoPath: string, workspaceDir: string, username: string, req: ScriptRunRequest | null) {
  return useQuery<ScriptRunResult>(runOptions(repoPath, workspaceDir, username, req ?? {}, !!req))
}

export function useWidgetRun(
  repoPath: string, workspaceDir: string, username: string, dashboardId: string, widget: Widget, queryScript: string | undefined,
  params?: Record<string, GraphParamValue>, enabled = true,
) {
  return useQuery<ScriptRunResult>(widgetRunOptions(repoPath, workspaceDir, username, dashboardId, widget, queryScript, params, enabled))
}
