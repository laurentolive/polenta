import type { Dashboard, QueryScope, Widget, WidgetFieldMapping, WidgetSize, WidgetType } from '@polenta/types'
import type { GitService } from './git.service'
import { readPref as readPrefStore, writePref as writePrefStore } from './pref-store.util'
import { generatePrivateId, isPrivateScopeId } from './id-scope.util'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'

export interface CreateDashboardDto {
  title: string
  scope: QueryScope
  createdBy: string
}

export interface UpdateDashboardDto {
  title?: string
  widgetOrder?: string[]
}

export interface AddWidgetDto {
  title: string
  queryId: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

export type UpdateWidgetDto = Partial<AddWidgetDto>

export interface DependentWidget {
  dashboardId: string
  dashboardTitle: string
  dashboardScope: QueryScope
  widgetId: string
  widgetTitle: string
}

interface PrefStore {
  dashboards?: Dashboard[]
  /** Ordre d'affichage de la section "Dashboards" du panneau latéral — même logique
   *  que `queriesOrder` dans saved-queries.service.ts. */
  dashboardsOrder?: string[]
  [key: string]: unknown
}

/**
 * DashboardsService — T77 sprint 2.
 *
 * CRUD des dashboards + widgets embarqués (un dashboard = un fichier YAML contenant
 * son tableau `widgets`, pas de fichier séparé par widget — même logique que les
 * approbations embarquées dans ReviewsService). Scope privé (`.{username}.pref`) ou
 * partagé (`dashboards/DASHBOARD-xxxx.yaml`, ID via `nextCounterId`, cf. `id-counter.util.ts`).
 *
 * Un widget n'a pas de scope propre : son scope effectif est celui de son dashboard
 * parent (T77-design.md § "Règles de dépendance et de scope"). La validation
 * "un widget partagé nécessite une requête partagée" est donc appliquée à DEUX
 * endroits : au moment du passage du dashboard en scope 'shared' (`setScope`), ET à
 * chaque `addWidget`/`updateWidget` sur un dashboard déjà partagé — sans ce second
 * point, un appel IPC direct pourrait embarquer un widget référençant une requête
 * privée dans un dashboard déjà partagé, en contournant le filtre proactif de
 * `WidgetConfigModal` (qui est côté UI seulement).
 *
 * Ce service ne dépend PAS de SavedQueriesService : il détermine si le queryId d'un
 * widget est privé ou partagé uniquement via la convention d'ID partagée
 * (`id-scope.util.ts`), pour éviter une dépendance circulaire — SavedQueriesService
 * importe ce service (pour `findDependentWidgets`), pas l'inverse.
 */
export class DashboardsService {
  constructor(private readonly git: GitService) {}

  // ─── Dashboards ───────────────────────────────────────────────────────────────

  async list(repoPath: string, username: string): Promise<Dashboard[]> {
    const priv = this.readPref(repoPath, username).dashboards ?? []
    const shared = await this.git.readYamlDir<Dashboard>(repoPath, 'dashboards')
    return [...priv, ...shared].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async get(repoPath: string, username: string, id: string): Promise<Dashboard | null> {
    if (isPrivateScopeId(id)) {
      return this.readPref(repoPath, username).dashboards?.find((d) => d.id === id) ?? null
    }
    return this.git.readYaml<Dashboard>(repoPath, `dashboards/${id}.yaml`)
  }

  async create(repoPath: string, username: string, dto: CreateDashboardDto): Promise<Dashboard> {
    if (dto.scope === 'shared') {
      const id = await nextCounterId(this.git, repoPath, 'DASHBOARD', 'dashboards')
      const dashboard: Dashboard = {
        id,
        title: dto.title,
        scope: 'shared',
        widgetOrder: [],
        widgets: [],
        createdBy: dto.createdBy,
        createdAt: new Date().toISOString(),
      }
      await assertNewObjectFile(this.git, repoPath, `dashboards/${id}.yaml`, id)
      await this.git.writeYaml(repoPath, `dashboards/${id}.yaml`, dashboard)
      return dashboard
    }

    const pref = this.readPref(repoPath, username)
    const list = pref.dashboards ?? []
    const dashboard: Dashboard = {
      id: generatePrivateId(),
      title: dto.title,
      scope: 'private',
      widgetOrder: [],
      widgets: [],
      createdBy: dto.createdBy,
      createdAt: new Date().toISOString(),
    }
    list.push(dashboard)
    pref.dashboards = list
    this.writePref(repoPath, username, pref)
    return dashboard
  }

  async update(repoPath: string, username: string, id: string, dto: UpdateDashboardDto): Promise<Dashboard> {
    return this.mutate(repoPath, username, id, (d) => ({ ...d, ...dto }))
  }

  async delete(repoPath: string, username: string, id: string): Promise<void> {
    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      pref.dashboards = (pref.dashboards ?? []).filter((d) => d.id !== id)
      this.writePref(repoPath, username, pref)
      return
    }
    await deleteWithTombstone(this.git, repoPath, `dashboards/${id}.yaml`, id)
  }

  /**
   * Promote (private → shared) or demote (shared → private) a dashboard.
   * T77.md § Visibilité: "Un Dashboard ne peut être partagé que si tous ses widgets
   * sont partagés" — checked here against the *current* widgets (proactive filtering
   * in WidgetConfigModal keeps this from being hit in the normal flow, but it's
   * re-checked here too, same defense-in-depth spirit as the SQL guard in
   * query-engine.service.ts). Demoting a shared dashboard back to private has no such
   * check: nothing else ever references a Dashboard by id (unlike SavedQuery), so
   * there are no dependents to protect.
   *
   * Also keeps `dashboardsOrder` (sidebar drag order) pointing at the new id in
   * place, rather than letting the item silently jump to the end of the list.
   */
  async setScope(repoPath: string, username: string, id: string, newScope: QueryScope): Promise<Dashboard> {
    const current = await this.get(repoPath, username, id)
    if (!current) throw new Error(`Dashboard introuvable : ${id}`)
    if (current.scope === newScope) return current

    let moved: Dashboard
    if (newScope === 'shared') {
      this.assertWidgetsShareable(current.widgets)
      const newId = await nextCounterId(this.git, repoPath, 'DASHBOARD', 'dashboards')
      moved = { ...current, id: newId, scope: 'shared' }
      await assertNewObjectFile(this.git, repoPath, `dashboards/${newId}.yaml`, newId)
      await this.git.writeYaml(repoPath, `dashboards/${newId}.yaml`, moved)
      const pref = this.readPref(repoPath, username)
      pref.dashboards = (pref.dashboards ?? []).filter((d) => d.id !== id)
      this.writePref(repoPath, username, pref)
    } else {
      await deleteWithTombstone(this.git, repoPath, `dashboards/${id}.yaml`, id)
      moved = { ...current, id: generatePrivateId(), scope: 'private' }
      const pref = this.readPref(repoPath, username)
      pref.dashboards = [...(pref.dashboards ?? []), moved]
      this.writePref(repoPath, username, pref)
    }

    this.renameInOrder(repoPath, username, id, moved.id)
    return moved
  }

  // ─── Widgets (embarqués dans le dashboard parent) ────────────────────────────

  async addWidget(repoPath: string, username: string, dashboardId: string, dto: AddWidgetDto): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d) => {
      if (d.scope === 'shared') this.assertWidgetsShareable([{ ...dto, id: '' } as Widget])
      const widget: Widget = { id: this.generateWidgetId(), ...dto }
      return { ...d, widgets: [...d.widgets, widget], widgetOrder: [...d.widgetOrder, widget.id] }
    })
  }

  async updateWidget(
    repoPath: string,
    username: string,
    dashboardId: string,
    widgetId: string,
    dto: UpdateWidgetDto,
  ): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d) => {
      const existing = d.widgets.find((w) => w.id === widgetId)
      const patched = existing ? { ...existing, ...dto } : undefined
      if (d.scope === 'shared' && patched) this.assertWidgetsShareable([patched])
      return { ...d, widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...dto } : w)) }
    })
  }

  async deleteWidget(repoPath: string, username: string, dashboardId: string, widgetId: string): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d) => ({
      ...d,
      widgets: d.widgets.filter((w) => w.id !== widgetId),
      widgetOrder: d.widgetOrder.filter((id) => id !== widgetId),
    }))
  }

  async setWidgetOrder(repoPath: string, username: string, dashboardId: string, order: string[]): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d) => ({ ...d, widgetOrder: order }))
  }

  // ─── Sidebar order (liste "Dashboards" réorganisable par drag & drop) ───────

  async getDashboardsOrder(repoPath: string, username: string): Promise<string[]> {
    return this.readPref(repoPath, username).dashboardsOrder ?? []
  }

  async setDashboardsOrder(repoPath: string, username: string, order: string[]): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.dashboardsOrder = order
    this.writePref(repoPath, username, pref)
  }

  // ─── Cross-service dependency check (used by SavedQueriesService) ───────────

  /**
   * T77-design.md § "Détection des dépendants" — scans shared dashboards + the
   * given user's own private dashboards for widgets referencing `queryId`. Known,
   * accepted limitation: a private dashboard belonging to a *different* user is
   * invisible from here (its `.{username}.pref` file isn't accessible from this
   * session) — documented in T77.md § Visibilité, not a bug to fix in this ticket.
   *
   * Skips the shared-dashboards disk scan entirely when `queryId` is itself private:
   * `addWidget`/`updateWidget`/`setScope` all guarantee a shared dashboard can never
   * embed a widget referencing a private query, so a private `queryId` can only ever
   * be found in the current user's own private dashboards — no need to pay for
   * reading every shared dashboard YAML in the repo to confirm that.
   */
  async findDependentWidgets(repoPath: string, username: string, queryId: string): Promise<DependentWidget[]> {
    const isPrivateQuery = isPrivateScopeId(queryId)
    const [shared, privateOwn] = await Promise.all([
      isPrivateQuery ? Promise.resolve([]) : this.git.readYamlDir<Dashboard>(repoPath, 'dashboards'),
      Promise.resolve(this.readPref(repoPath, username).dashboards ?? []),
    ])
    const dependents: DependentWidget[] = []
    for (const dashboard of [...shared, ...privateOwn]) {
      for (const widget of dashboard.widgets) {
        if (widget.queryId === queryId) {
          dependents.push({
            dashboardId: dashboard.id,
            dashboardTitle: dashboard.title,
            dashboardScope: dashboard.scope,
            widgetId: widget.id,
            widgetTitle: widget.title,
          })
        }
      }
    }
    return dependents
  }

  /**
   * Called by `SavedQueriesService.setScope()` after promoting a private query to
   * shared (a query's id changes across that transition) — updates any widget in the
   * user's OWN private dashboards still pointing at the old id, so promoting a query
   * doesn't silently orphan a widget that legitimately referenced it (promote is
   * unconditional per spec, so it can't be blocked the way delete/demote are). Shared
   * dashboards are never scanned here: they could never have referenced a private
   * query id in the first place (same invariant as `findDependentWidgets`).
   */
  async remapWidgetQueryId(repoPath: string, username: string, oldQueryId: string, newQueryId: string): Promise<void> {
    const pref = this.readPref(repoPath, username)
    const dashboards = pref.dashboards ?? []
    let changed = false
    const updated = dashboards.map((d) => {
      if (!d.widgets.some((w) => w.queryId === oldQueryId)) return d
      changed = true
      return { ...d, widgets: d.widgets.map((w) => (w.queryId === oldQueryId ? { ...w, queryId: newQueryId } : w)) }
    })
    if (!changed) return
    pref.dashboards = updated
    this.writePref(repoPath, username, pref)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** T77.md § Visibilité: "un widget ne peut être partagé que si sa requête est
   *  partagée" — throws naming the offending widgets if any reference a private
   *  query. Used both by `setScope('shared')` (checks all existing widgets) and by
   *  `addWidget`/`updateWidget` on an already-shared dashboard (checks the single
   *  incoming widget) so the invariant holds regardless of entry point. */
  private assertWidgetsShareable(widgets: Widget[]): void {
    const offenders = widgets.filter((w) => isPrivateScopeId(w.queryId))
    if (offenders.length === 0) return
    const list = offenders.map((w) => `"${w.title}"`).join(', ')
    throw new Error(
      `Impossible de partager ce dashboard : ${offenders.length} widget(s) référencent une requête privée — ${list}. Partagez d'abord ces requêtes.`,
    )
  }

  /** Keeps the sidebar drag order pointing at an object's new id after a scope
   *  change (private↔shared) mints a fresh id — otherwise `dashboardsOrder` would
   *  still reference the old, now-nonexistent id and the item would silently move to
   *  the end of the list (`ReorderableSidebarSection` appends unknown ids last). */
  private renameInOrder(repoPath: string, username: string, oldId: string, newId: string): void {
    const pref = this.readPref(repoPath, username)
    const order = pref.dashboardsOrder
    if (!order || !order.includes(oldId)) return
    pref.dashboardsOrder = order.map((entryId) => (entryId === oldId ? newId : entryId))
    this.writePref(repoPath, username, pref)
  }

  /** Read-modify-write a single dashboard, private or shared, resolved by id prefix. */
  private async mutate(
    repoPath: string,
    username: string,
    id: string,
    fn: (d: Dashboard) => Dashboard,
  ): Promise<Dashboard> {
    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      const list = pref.dashboards ?? []
      const idx = list.findIndex((d) => d.id === id)
      if (idx < 0) throw new Error(`Dashboard introuvable : ${id}`)
      const updated = fn(list[idx])
      list[idx] = updated
      pref.dashboards = list
      this.writePref(repoPath, username, pref)
      return updated
    }

    const existing = await this.git.readYaml<Dashboard>(repoPath, `dashboards/${id}.yaml`)
    if (!existing) throw new Error(`Dashboard introuvable : ${id}`)
    const updated = fn(existing)
    await this.git.writeYaml(repoPath, `dashboards/${id}.yaml`, updated)
    return updated
  }

  private generateWidgetId(): string {
    return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private readPref(repoPath: string, username: string): PrefStore {
    return readPrefStore(repoPath, username) as PrefStore
  }

  private writePref(repoPath: string, username: string, data: PrefStore): void {
    writePrefStore(repoPath, username, data)
  }
}
