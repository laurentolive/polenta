import type {
  BuilderConfig,
  ProjectSchema,
  QueryHistoryEntry,
  QueryMode,
  QueryScope,
  SavedQuery,
} from '@polenta/types'
import type { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import type { DashboardsService } from './dashboards.service'
import { findObjectTypeDef, SYSTEM_QUERY_FIELDS } from './schema-lookup.util'
import { readPref as readPrefStore, writePref as writePrefStore } from './pref-store.util'
import { generatePrivateId, isPrivateScopeId } from './id-scope.util'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'

export interface CreateSavedQueryDto {
  title: string
  mode: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
  scope: QueryScope
  createdBy: string
}

export interface UpdateSavedQueryDto {
  title?: string
  /** GH18 — changement de mode (tool MCP `update_query`) ; la définition de l'autre mode
   *  est alors retirée (`withSingleDefinition`). Jamais envoyé par l'UI actuelle. */
  mode?: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
}

export type AddHistoryEntryDto = Omit<QueryHistoryEntry, 'id' | 'executedAt'>

/** Deux entrées désignent la même requête si même mode et même contenu (builderConfig
 *  ou sqlText selon le mode) — ordre des conditions/clés du builder inclus, comme pour
 *  `entryFilterText` côté renderer (query.tsx). */
function isSameHistoryQuery(a: QueryHistoryEntry, b: AddHistoryEntryDto): boolean {
  if (a.mode !== b.mode) return false
  if (a.mode === 'sql') return (a.sqlText ?? '') === (b.sqlText ?? '')
  return JSON.stringify(a.builderConfig ?? {}) === JSON.stringify(b.builderConfig ?? {})
}

/** Une requête sauvegardée porte la définition de son mode, jamais les deux (GH18 :
 *  `update` peut désormais changer `mode`). */
function withSingleDefinition(q: SavedQuery): SavedQuery {
  // Copie + delete plutôt que déstructuration : garde l'ordre des clés du YAML (diff git minimal).
  const out = { ...q }
  if (out.mode === 'sql') delete out.builderConfig
  else delete out.sqlText
  return out
}

interface PrefStore {
  savedQueries?: SavedQuery[]
  queryHistory?: QueryHistoryEntry[]
  /** Ordre d'affichage de la section "Requêtes" du panneau latéral (T77 §"Panneau
   *  latéral") — une préférence d'affichage personnelle, indépendante du scope
   *  privé/partagé de chaque requête référencée. */
  queriesOrder?: string[]
  [key: string]: unknown
}

/**
 * SavedQueriesService — T77 sprint 1 (CRUD + historique) puis sprint 2 (règles de
 * dépendance widget/dashboard).
 *
 * CRUD des requêtes sauvegardées + historique. Scope privé (stocké dans le fichier
 * de préférences `.{username}.pref`, jamais committé) ou partagé (fichier YAML
 * versionné dans `queries/`, ID via `nextCounterId`, même mécanisme que
 * ReviewsService, cf. `id-counter.util.ts`).
 *
 * `dashboards` est optionnel uniquement pour ne pas casser un appel de test qui
 * construirait ce service sans dépendance — en usage réel (`container.ts`) il est
 * toujours fourni, sans quoi delete()/setScope() ne pourraient pas détecter les
 * widgets dépendants (T77-design.md § "Règles de dépendance et de scope").
 */
export class SavedQueriesService {
  constructor(
    private readonly git: GitService,
    private readonly schema: SchemaService,
    private readonly dashboards?: DashboardsService,
  ) {}

  // ─── Saved queries ───────────────────────────────────────────────────────────

  async list(repoPath: string, username: string): Promise<SavedQuery[]> {
    const priv = this.readPref(repoPath, username).savedQueries ?? []
    const shared = await this.git.readYamlDir<SavedQuery>(repoPath, 'queries')
    return [...priv, ...shared].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async create(repoPath: string, username: string, dto: CreateSavedQueryDto): Promise<SavedQuery> {
    if (dto.scope === 'shared') {
      const id = await nextCounterId(this.git, repoPath, 'QUERY', 'queries')
      const query: SavedQuery = {
        id,
        title: dto.title,
        mode: dto.mode,
        builderConfig: dto.builderConfig,
        sqlText: dto.sqlText,
        scope: 'shared',
        createdBy: dto.createdBy,
        createdAt: new Date().toISOString(),
      }
      await assertNewObjectFile(this.git, repoPath, `queries/${id}.yaml`, id)
      await this.git.writeYaml(repoPath, `queries/${id}.yaml`, query)
      return query
    }

    const pref = this.readPref(repoPath, username)
    const list = pref.savedQueries ?? []
    const query: SavedQuery = {
      id: generatePrivateId(),
      title: dto.title,
      mode: dto.mode,
      builderConfig: dto.builderConfig,
      sqlText: dto.sqlText,
      scope: 'private',
      createdBy: dto.createdBy,
      createdAt: new Date().toISOString(),
    }
    list.push(query)
    pref.savedQueries = list
    this.writePref(repoPath, username, pref)
    return query
  }

  async update(repoPath: string, username: string, id: string, dto: UpdateSavedQueryDto): Promise<SavedQuery> {
    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      const list = pref.savedQueries ?? []
      const idx = list.findIndex((q) => q.id === id)
      if (idx < 0) throw new Error(`Requête introuvable : ${id}`)
      list[idx] = withSingleDefinition({ ...list[idx], ...dto })
      pref.savedQueries = list
      this.writePref(repoPath, username, pref)
      return list[idx]
    }

    const existing = await this.git.readYaml<SavedQuery>(repoPath, `queries/${id}.yaml`)
    if (!existing) throw new Error(`Requête introuvable : ${id}`)
    const updated: SavedQuery = withSingleDefinition({ ...existing, ...dto })
    await this.git.writeYaml(repoPath, `queries/${id}.yaml`, updated)
    return updated
  }

  async delete(repoPath: string, username: string, id: string): Promise<void> {
    await this.assertNoDependents(repoPath, username, id, 'supprimer')

    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = (pref.savedQueries ?? []).filter((q) => q.id !== id)
      this.writePref(repoPath, username, pref)
      return
    }
    await deleteWithTombstone(this.git, repoPath, `queries/${id}.yaml`, id)
  }

  /**
   * Promote (private → shared, always free — T77.md § Visibilité) or demote (shared →
   * private, blocked if any widget depends on this query — same rule as delete()) a
   * saved query. Changes the query's `id` (private/shared IDs use different schemes —
   * `local-…` vs `QUERY-0001`).
   *
   * Demote is safe because it's only allowed when `assertNoDependents` finds zero
   * dependents. Promote has no such guard (per spec it's unconditional — "libre à
   * tout moment"), so a widget could legitimately reference this query's *old* id —
   * but only from one of the *same user's own* private dashboards (a shared
   * dashboard could never have referenced a private query id in the first place, cf.
   * DashboardsService.addWidget's scope guard). We fix those references up via
   * `remapWidgetQueryId` rather than blocking the promote (which the spec forbids)
   * or leaving them dangling.
   *
   * Also keeps `queriesOrder` (sidebar drag order) pointing at the new id in place,
   * rather than letting the item silently jump to the end of the list.
   */
  async setScope(repoPath: string, username: string, id: string, newScope: QueryScope): Promise<SavedQuery> {
    const current = await this.findOne(repoPath, username, id)
    if (!current) throw new Error(`Requête introuvable : ${id}`)
    if (current.scope === newScope) return current

    let moved: SavedQuery
    if (newScope === 'private') {
      await this.assertNoDependents(repoPath, username, id, 'repasser en privé')
      await deleteWithTombstone(this.git, repoPath, `queries/${id}.yaml`, id)
      moved = { ...current, id: generatePrivateId(), scope: 'private' }
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = [...(pref.savedQueries ?? []), moved]
      this.writePref(repoPath, username, pref)
    } else {
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = (pref.savedQueries ?? []).filter((q) => q.id !== id)
      this.writePref(repoPath, username, pref)
      const newId = await nextCounterId(this.git, repoPath, 'QUERY', 'queries')
      moved = { ...current, id: newId, scope: 'shared' }
      await assertNewObjectFile(this.git, repoPath, `queries/${newId}.yaml`, newId)
      await this.git.writeYaml(repoPath, `queries/${newId}.yaml`, moved)
      // Cascade the id change to widgets in the user's own private dashboards that
      // referenced the old (now-deleted) private id — see doc comment above.
      if (this.dashboards) await this.dashboards.remapWidgetQueryId(repoPath, username, id, newId)
    }

    this.renameInOrder(repoPath, username, id, moved.id)
    return moved
  }

  /** Keeps the sidebar drag order pointing at an object's new id after a scope
   *  change (private↔shared) mints a fresh id — otherwise `queriesOrder` would still
   *  reference the old, now-nonexistent id and the item would silently move to the
   *  end of the list (`ReorderableSidebarSection` appends unknown ids last). */
  private renameInOrder(repoPath: string, username: string, oldId: string, newId: string): void {
    const pref = this.readPref(repoPath, username)
    const order = pref.queriesOrder
    if (!order || !order.includes(oldId)) return
    pref.queriesOrder = order.map((entryId) => (entryId === oldId ? newId : entryId))
    this.writePref(repoPath, username, pref)
  }

  async findOne(repoPath: string, username: string, id: string): Promise<SavedQuery | null> {
    if (isPrivateScopeId(id)) {
      return this.readPref(repoPath, username).savedQueries?.find((q) => q.id === id) ?? null
    }
    return this.git.readYaml<SavedQuery>(repoPath, `queries/${id}.yaml`)
  }

  /** T77-design.md § "Détection des dépendants" — throws with the dependent widgets/
   *  dashboards listed if any exist, otherwise resolves silently. */
  private async assertNoDependents(repoPath: string, username: string, id: string, action: string): Promise<void> {
    if (!this.dashboards) return
    const dependents = await this.dashboards.findDependentWidgets(repoPath, username, id)
    if (dependents.length === 0) return
    const list = dependents
      .map((d) => `"${d.widgetTitle}" (dashboard "${d.dashboardTitle}", ${d.dashboardScope === 'shared' ? 'partagé' : 'privé'})`)
      .join(', ')
    throw new Error(
      `Impossible de ${action} cette requête : utilisée par ${dependents.length} widget(s) — ${list}.`,
    )
  }

  // ─── History (toujours privé) ────────────────────────────────────────────────

  async addHistoryEntry(repoPath: string, username: string, entry: AddHistoryEntryDto): Promise<QueryHistoryEntry> {
    const pref = this.readPref(repoPath, username)
    // Ré-exécuter une requête déjà présente dans l'historique ne doit pas créer un
    // doublon : on retire l'ancienne entrée équivalente pour ne garder que la plus
    // récente en tête (comportement historique navigateur/shell).
    const list = (pref.queryHistory ?? []).filter((e) => !isSameHistoryQuery(e, entry))
    const full: QueryHistoryEntry = {
      ...entry,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      executedAt: new Date().toISOString(),
    }
    list.unshift(full)
    pref.queryHistory = list
    this.writePref(repoPath, username, pref)
    return full
  }

  /**
   * List history entries, purging (and persisting the purge) any entry that has
   * become invalid — its builder-mode objectTypeRef or a referenced field no longer
   * exists in the schema. SQL-mode entries are never purged here: without parsing
   * the SQL we can't reliably tell a stale field reference from a deliberate raw
   * query, so we only purge what we can actually verify (documented sprint 1
   * limitation — see specs/T77-sprint1.md).
   */
  async listHistory(repoPath: string, username: string): Promise<QueryHistoryEntry[]> {
    const pref = this.readPref(repoPath, username)
    const list = pref.queryHistory ?? []
    if (list.length === 0) return list

    const schema = await this.schema.get(repoPath)
    const valid = list.filter((entry) => this.isHistoryEntryValid(entry, schema))
    if (valid.length !== list.length) {
      pref.queryHistory = valid
      this.writePref(repoPath, username, pref)
    }
    return valid
  }

  async deleteHistoryEntry(repoPath: string, username: string, id: string): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.queryHistory = (pref.queryHistory ?? []).filter((e) => e.id !== id)
    this.writePref(repoPath, username, pref)
  }

  // ─── Sidebar order (liste "Requêtes" réorganisable par drag & drop) ─────────

  async getQueriesOrder(repoPath: string, username: string): Promise<string[]> {
    return this.readPref(repoPath, username).queriesOrder ?? []
  }

  async setQueriesOrder(repoPath: string, username: string, order: string[]): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.queriesOrder = order
    this.writePref(repoPath, username, pref)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private isHistoryEntryValid(entry: QueryHistoryEntry, schema: ProjectSchema): boolean {
    if (entry.mode !== 'builder' || !entry.builderConfig) return true

    const typeDef = findObjectTypeDef(schema, entry.builderConfig.objectTypeRef)
    if (typeDef === 'unresolvable') return true // composant non local — impossible à vérifier ici
    if (!typeDef) return false // le type a été supprimé du schéma

    const allowed = new Set([...SYSTEM_QUERY_FIELDS, ...typeDef.fields.map((f) => f.name)])
    const fieldsUsed = [
      ...entry.builderConfig.conditions.map((c) => c.field),
      ...(entry.builderConfig.groupBy ?? []),
    ]
    return fieldsUsed.every((f) => allowed.has(f))
  }

  // Thin wrappers around the shared `.{username}.pref` reader/writer (pref-store.util,
  // also used by ipc/pref.handlers.ts for `fieldVisibility`) — just narrows the return
  // type to this service's own known keys.
  private readPref(repoPath: string, username: string): PrefStore {
    return readPrefStore(repoPath, username) as PrefStore
  }

  private writePref(repoPath: string, username: string, data: PrefStore): void {
    writePrefStore(repoPath, username, data)
  }
}
