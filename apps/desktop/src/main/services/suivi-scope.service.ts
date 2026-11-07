import type { Dashboard, DashboardSharePreview, QueryScope, QueryScopeBlocker, QueryScopePreview, SavedQuery } from '@polenta/types'
import { isPrivateScopeId } from '@polenta/types'
import type { DashboardsService } from './dashboards.service'
import type { SavedQueriesService } from './saved-queries.service'
import { readOnlyError } from './suivi-store.util'
import { assertScope } from './id-scope.util'

/**
 * SuiviScopeService — changements de portée de la vue Suivi (GH67) : aperçus (ce qui sera fait, ce
 * qui bloque) et partage d'un dashboard privé avec ses requêtes privées en une action.
 *
 * Les écritures passent toutes par `SavedQueriesService.setScope` / `DashboardsService.setScope`
 * (seul chemin d'écriture d'un changement de portée) ; ce service ne fait que les enchaîner. Il
 * dépend des deux, aucun des deux ne le connaît (pas de dépendance circulaire).
 */
export class SuiviScopeService {
  constructor(
    private readonly queries: SavedQueriesService,
    private readonly dashboards: DashboardsService,
  ) {}

  /** Aperçu du passage d'une requête à la portée `to`. */
  async previewQueryScope(repoPath: string, username: string, id: string, to: QueryScope): Promise<QueryScopePreview> {
    assertScope(to)
    const q = await this.queries.findOne(repoPath, username, id)
    if (!q) throw new Error(`Requête introuvable : ${id}`)
    return this.previewOf(repoPath, username, q, to, () => this.sharedQueries(repoPath, username))
  }

  /** Aperçu du partage d'un dashboard privé : ses requêtes privées, et ce qui bloque. */
  async previewDashboardShare(repoPath: string, username: string, id: string): Promise<DashboardSharePreview> {
    const d = await this.dashboards.get(repoPath, username, id)
    if (!d) throw new Error(`Dashboard introuvable : ${id}`)
    if (d.state.readOnly) throw readOnlyError(`Dashboard ${id}`, d.state.readOnly)
    if (d.scope === 'shared') throw new Error(`Dashboard déjà partagé : ${id}`)
    const out: DashboardSharePreview = { dashboardId: id, queries: [], missing: [] }
    const shared = await this.sharedQueries(repoPath, username)
    const privateIds = [...new Set(d.widgets.map((w) => w.queryId).filter(isPrivateScopeId))]
    for (const queryId of privateIds) {
      const q = await this.queries.findOne(repoPath, username, queryId)
      if (!q) {
        for (const w of d.widgets.filter((x) => x.queryId === queryId)) out.missing.push({ widgetId: w.id, widgetTitle: w.title, queryId })
        continue
      }
      const preview = await this.previewOf(repoPath, username, q, 'shared', async () => shared)
      out.queries.push({
        ...preview,
        widgets: d.widgets.filter((w) => w.queryId === queryId).map((w) => ({ widgetId: w.id, widgetTitle: w.title })),
        remapped: preview.remapped.filter((r) => r.dashboardId !== id),
      })
    }
    // Deux requêtes du lot au même titre deviendraient deux requêtes partagées homonymes : signalé.
    for (const q of out.queries) {
      const key = normalizedTitle(q.title)
      q.titleTakenBy.push(...out.queries.filter((o) => o !== q && normalizedTitle(o.title) === key).map((o) => o.queryId))
    }
    return out
  }

  /**
   * Partage d'un dashboard privé avec ses requêtes privées : chaque requête est promue (widgets des
   * dashboards privés remappés), puis le dashboard. Aperçu recalculé d'abord : un bloquant → refus
   * sans écriture (`SCOPE_BLOCKED`). Un échec en route laisse les requêtes déjà promues partagées
   * (état cohérent, pas d'annulation — spec §3.6) ; relancer reprend sur les requêtes restantes.
   */
  async shareDashboardWithQueries(repoPath: string, username: string, id: string): Promise<Dashboard> {
    const preview = await this.previewDashboardShare(repoPath, username, id)
    const blocked = [
      ...preview.queries.filter((q) => q.blockers.length > 0).map((q) => `"${q.title}" (${q.blockers.map(blockerText).join(' ; ')})`),
      ...preview.missing.map((m) => `widget "${m.widgetTitle}" (requête introuvable)`),
    ]
    if (blocked.length > 0) throw new Error(`SCOPE_BLOCKED: impossible de partager ce dashboard — ${blocked.join(', ')}.`)
    const total = preview.queries.length
    let done = 0
    try {
      for (const q of preview.queries) {
        await this.queries.setScope(repoPath, username, q.queryId, 'shared')
        done += 1
      }
      // Le remappage ne touche que les widgets : l'id du dashboard privé n'a pas changé.
      return await this.dashboards.setScope(repoPath, username, id, 'shared')
    } catch (err) {
      // Rien de promu : l'erreur d'origine telle quelle (son code éventuel est conservé).
      if (done === 0) throw err
      const message = err instanceof Error ? err.message : String(err)
      const step = done < total ? "le dashboard n'a pas été partagé" : 'le partage du dashboard a échoué'
      throw new Error(`SCOPE_PARTIAL: ${done} requête(s) sur ${total} partagée(s) ; ${step} : ${message}`)
    }
  }

  // ─── Outils ───────────────────────────────────────────────────────────────────

  private async sharedQueries(repoPath: string, username: string): Promise<SavedQuery[]> {
    return (await this.queries.list(repoPath, username)).filter((q) => q.scope === 'shared')
  }

  /** Les gardes reprennent celles de `SavedQueriesService.setScope` (lecture seule, paramètres,
   *  dépendants) : à garder alignées. `shared` n'est lu que pour une promotion. */
  private async previewOf(repoPath: string, username: string, q: SavedQuery, to: QueryScope, shared: () => Promise<SavedQuery[]>): Promise<QueryScopePreview> {
    const base: QueryScopePreview = { queryId: q.id, title: q.title, from: q.scope, to, blockers: [], remapped: [], titleTakenBy: [], columnRemoved: null }
    if (q.scope === to) return base
    const blockers: QueryScopeBlocker[] = []
    if (q.state.readOnly) blockers.push({ kind: 'read-only', reason: q.state.readOnly })
    if (q.parametersError) blockers.push({ kind: 'params', message: q.parametersError })
    const dependents = await this.dashboards.findDependentWidgets(repoPath, username, q.id)
    if (to === 'private') {
      if (dependents.length > 0) blockers.push({ kind: 'dependents', widgets: dependents })
      return { ...base, blockers, columnRemoved: q.column?.label ?? null }
    }
    const key = normalizedTitle(q.title)
    return {
      ...base,
      blockers,
      remapped: dependents,
      titleTakenBy: (await shared()).filter((s) => s.id !== q.id && normalizedTitle(s.title) === key).map((s) => s.id),
    }
  }
}

function normalizedTitle(title: string): string {
  return title.trim().toLowerCase()
}

function blockerText(b: QueryScopeBlocker): string {
  switch (b.kind) {
    case 'read-only': return `lecture seule : ${b.reason}`
    case 'params': return `paramètres invalides : ${b.message}`
    case 'dependents': return `utilisée par ${b.widgets.length} widget(s)`
  }
}
