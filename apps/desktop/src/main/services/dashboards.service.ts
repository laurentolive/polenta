import type { Dashboard, GraphParamValue, QueryParameterKind, QueryScope, ReadDashboard, ReadWidget, StoredDashboard, StoredWidget, TemplateRef, Widget, WidgetCode, WidgetSize } from '@polenta/types'
import { normalizeParamValue, QUERY_PARAMETER_KINDS, readDashboardRecord, SUIVI_FORMAT_VERSION, widgetCodeForHash } from '@polenta/types'
import type { GitService } from './git.service'
import { readPref as readPrefStore, writePref as writePrefStore } from './pref-store.util'
import { generatePrivateId, isPrivateScopeId } from './id-scope.util'
import { nextCounterId } from './id-counter.util'
import {
  applyWidgetTemplate, computeState, dropLegacyFile, removeSharedObject, listObjectEntries, readOnlyError, readText, readYamlFile, toYaml, withHash,
  writeObjectFolder,
} from './suivi-store.util'
import type { TemplateInput } from './suivi-store.util'

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
  size: WidgetSize
  /** Code fourni (widget personnalisé)… */
  transform?: string
  spec?: string
  /** …ou modèle + paramètres : transformation et spec générées. */
  template?: TemplateInput
}

export interface UpdateWidgetDto {
  title?: string
  queryId?: string
  size?: WidgetSize
  /** Code modifié : la référence de modèle est conservée (widget détaché si le code diffère).
   *  `transform: null` retire la transformation. */
  transform?: string | null
  spec?: string
  /** Modèle / paramètres : code régénéré. `null` : retire la référence. */
  template?: TemplateInput | null
}

export interface DependentWidget {
  dashboardId: string
  dashboardTitle: string
  dashboardScope: QueryScope
  widgetId: string
  widgetTitle: string
}

const DIR = 'dashboards'
const PREFIX = 'DASHBOARD'

interface PrefStore {
  dashboards?: Record<string, unknown>[]
  /** Ordre d'affichage de la section "Dashboards" du panneau latéral (préférence personnelle). */
  dashboardsOrder?: string[]
  /** GH93 — valeurs choisies dans la barre de paramètres : dashboard → sélecteur (`name:kind`) →
   *  valeur (`null` = « Tous / Toutes » choisi). Absente : défaut de la déclaration. */
  suiviParamValues?: Record<string, Record<string, GraphParamValue>>
  [key: string]: unknown
}

/** Dashboard en cours de modification (code des widgets inclus, sans état calculé). */
interface DraftWidget {
  id: string
  title: string
  queryId: string
  size: WidgetSize
  transform?: string
  spec: string
  template?: TemplateRef
}

interface Draft {
  id: string
  title: string
  widgetOrder: string[]
  widgets: DraftWidget[]
  createdBy: string
  createdAt: string
}

/**
 * DashboardsService — dashboards de la vue Suivi (GH74). Partagé :
 * `dashboards/DASHBOARD-xxxx/{dashboard.yaml,<widget>.js,<widget>.vl.json}` ; privé : clé
 * `dashboards` du `.{username}.pref` (code des widgets inclus). Format d'avant GH74
 * (`dashboards/DASHBOARD-xxxx.yaml`, widgets `type` + `fieldMapping`) converti en mémoire, réécrit au
 * format v1 à la première modification. Un dashboard d'un format plus récent n'est jamais réécrit.
 *
 * Un widget n'a pas de portée propre : un dashboard partagé ne peut embarquer qu'un widget dont la
 * requête est partagée (vérifié ici, en plus du filtre de l'UI). Ce service ne dépend pas de
 * `SavedQueriesService` (portée déduite de l'id, `id-scope.util.ts`).
 */
export class DashboardsService {
  constructor(private readonly git: GitService) {}

  // ─── Lecture ──────────────────────────────────────────────────────────────────

  async list(repoPath: string, username: string): Promise<Dashboard[]> {
    const priv = (this.readPref(repoPath, username).dashboards ?? []).map((raw) => this.toDashboard(readDashboardRecord(raw), 'private'))
    const entries = await listObjectEntries(repoPath, DIR, PREFIX)
    const shared = (await Promise.all(entries.map((e) => this.readShared(repoPath, e.id)))).filter((d): d is Dashboard => d !== null)
    return [...priv, ...shared].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async get(repoPath: string, username: string, id: string): Promise<Dashboard | null> {
    if (isPrivateScopeId(id)) {
      const raw = this.readPref(repoPath, username).dashboards?.find((d) => d.id === id)
      return raw ? this.toDashboard(readDashboardRecord(raw), 'private') : null
    }
    return this.readShared(repoPath, id)
  }

  /**
   * Un widget, sans lire le code des autres widgets du dashboard (exécution d'un widget : appelée
   * une fois par widget à chaque rafraîchissement).
   */
  async getWidget(repoPath: string, username: string, dashboardId: string, widgetId: string): Promise<Widget | null> {
    if (isPrivateScopeId(dashboardId)) return (await this.get(repoPath, username, dashboardId))?.widgets.find((w) => w.id === widgetId) ?? null
    const folder = await readYamlFile<Record<string, unknown>>(repoPath, `${DIR}/${dashboardId}/dashboard.yaml`)
    if (!folder) return (await this.get(repoPath, username, dashboardId))?.widgets.find((w) => w.id === widgetId) ?? null
    const raw = (Array.isArray(folder.widgets) ? folder.widgets as { id?: unknown }[] : []).find((w) => String(w.id) === widgetId)
    if (!raw) return null
    const [transform, spec] = await Promise.all([
      readText(repoPath, `${DIR}/${dashboardId}/${widgetId}.js`),
      readText(repoPath, `${DIR}/${dashboardId}/${widgetId}.vl.json`),
    ])
    const one = readDashboardRecord({ ...folder, widgets: [raw], widgetOrder: [widgetId] }, {
      [widgetId]: { ...(transform !== undefined ? { transform } : {}), ...(spec !== undefined ? { spec } : {}) },
    })
    return this.toDashboard(one, 'shared').widgets[0] ?? null
  }

  private async readShared(repoPath: string, id: string): Promise<Dashboard | null> {
    const folder = await readYamlFile<Record<string, unknown>>(repoPath, `${DIR}/${id}/dashboard.yaml`)
    if (folder) {
      const widgets = Array.isArray(folder.widgets) ? (folder.widgets as { id?: unknown }[]) : []
      const codes: Record<string, Partial<WidgetCode>> = {}
      await Promise.all(widgets.map(async (w) => {
        const wid = String(w.id)
        const [transform, spec] = await Promise.all([
          readText(repoPath, `${DIR}/${id}/${wid}.js`),
          readText(repoPath, `${DIR}/${id}/${wid}.vl.json`),
        ])
        codes[wid] = { ...(transform !== undefined ? { transform } : {}), ...(spec !== undefined ? { spec } : {}) }
      }))
      return this.toDashboard(readDashboardRecord(folder, codes), 'shared')
    }
    const legacy = await readYamlFile<Record<string, unknown>>(repoPath, `${DIR}/${id}.yaml`)
    return legacy ? this.toDashboard(readDashboardRecord(legacy), 'shared') : null
  }

  private toDashboard(d: ReadDashboard, scope: QueryScope): Dashboard {
    return {
      id: d.id,
      title: d.title,
      scope,
      formatVersion: d.formatVersion,
      widgetOrder: d.widgetOrder,
      widgets: d.widgets.map((w) => this.toWidget(w, d.readOnly)),
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      state: { customized: false, ...(d.readOnly ? { readOnly: d.readOnly } : {}), ...(d.legacyFormat ? { legacyFormat: true } : {}) },
    }
  }

  private toWidget(w: ReadWidget, readOnly: ReadDashboard['readOnly']): Widget {
    const code = widgetCodeForHash({ transform: w.transform, spec: w.spec })
    const template = w.template ? withHash(w.template, code) : undefined
    return {
      id: w.id,
      title: w.title,
      queryId: w.queryId,
      size: w.size,
      ...(w.transform !== undefined ? { transform: w.transform } : {}),
      spec: w.spec,
      ...(template ? { template } : {}),
      state: computeState(w.template, code, 'widget', { readOnly, legacyFormat: w.legacyFormat }),
    }
  }

  // ─── Dashboards ───────────────────────────────────────────────────────────────

  async create(repoPath: string, username: string, dto: CreateDashboardDto): Promise<Dashboard> {
    const draft: Omit<Draft, 'id'> = { title: dto.title, widgetOrder: [], widgets: [], createdBy: dto.createdBy, createdAt: new Date().toISOString() }
    if (dto.scope === 'shared') {
      const id = await nextCounterId(this.git, repoPath, PREFIX, DIR)
      if (await this.git.fileExists(repoPath, `${DIR}/${id}`)) throw new Error(`${id} already exists`)
      await this.writeShared(repoPath, { id, ...draft })
      return (await this.readShared(repoPath, id))!
    }
    const id = generatePrivateId()
    const pref = this.readPref(repoPath, username)
    pref.dashboards = [...(pref.dashboards ?? []), this.toPrivate({ id, ...draft })]
    this.writePref(repoPath, username, pref)
    return (await this.get(repoPath, username, id))!
  }

  async update(repoPath: string, username: string, id: string, dto: UpdateDashboardDto): Promise<Dashboard> {
    return this.mutate(repoPath, username, id, (d) => ({
      ...d,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.widgetOrder !== undefined ? { widgetOrder: dto.widgetOrder } : {}),
    }))
  }

  async delete(repoPath: string, username: string, id: string): Promise<void> {
    this.writeParamValues(repoPath, username, id, null)
    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      pref.dashboards = (pref.dashboards ?? []).filter((d) => d.id !== id)
      this.writePref(repoPath, username, pref)
      return
    }
    await this.removeShared(repoPath, id)
  }

  /**
   * Passage privé → partagé (refusé si un widget référence une requête privée) ou partagé → privé.
   * L'id change ; l'ordre du panneau latéral suit.
   */
  async setScope(repoPath: string, username: string, id: string, newScope: QueryScope): Promise<Dashboard> {
    const current = await this.get(repoPath, username, id)
    if (!current) throw new Error(`Dashboard introuvable : ${id}`)
    if (current.scope === newScope) return current
    if (current.state.readOnly) throw readOnlyError(`Dashboard ${id}`, current.state.readOnly)
    const draft = this.toDraft(current)
    let newId: string
    if (newScope === 'shared') {
      this.assertWidgetsShareable(draft.widgets)
      newId = await nextCounterId(this.git, repoPath, PREFIX, DIR)
      await this.writeShared(repoPath, { ...draft, id: newId })
      const pref = this.readPref(repoPath, username)
      pref.dashboards = (pref.dashboards ?? []).filter((d) => d.id !== id)
      this.writePref(repoPath, username, pref)
    } else {
      await this.removeShared(repoPath, id)
      newId = generatePrivateId()
      const pref = this.readPref(repoPath, username)
      pref.dashboards = [...(pref.dashboards ?? []), this.toPrivate({ ...draft, id: newId })]
      this.writePref(repoPath, username, pref)
    }
    this.renameInOrder(repoPath, username, id, newId)
    return (await this.get(repoPath, username, newId))!
  }

  // ─── Widgets ──────────────────────────────────────────────────────────────────

  async addWidget(repoPath: string, username: string, dashboardId: string, dto: AddWidgetDto): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d, scope) => {
      const widget: DraftWidget = { id: this.generateWidgetId(), title: dto.title, queryId: dto.queryId, size: dto.size, ...this.resolveCode(dto) }
      if (scope === 'shared') this.assertWidgetsShareable([widget])
      return { ...d, widgets: [...d.widgets, widget], widgetOrder: [...d.widgetOrder, widget.id] }
    })
  }

  async updateWidget(repoPath: string, username: string, dashboardId: string, widgetId: string, dto: UpdateWidgetDto): Promise<Dashboard> {
    return this.mutate(repoPath, username, dashboardId, (d, scope) => {
      const widgets = d.widgets.map((w) => {
        if (w.id !== widgetId) return w
        let next: DraftWidget = {
          ...w,
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.queryId !== undefined ? { queryId: dto.queryId } : {}),
          ...(dto.size !== undefined ? { size: dto.size } : {}),
        }
        if (dto.template === null) {
          const { template: _t, ...rest } = next
          next = rest
        } else if (dto.template) {
          const { code, template } = applyWidgetTemplate(dto.template)
          const { transform: _old, ...rest } = next
          next = { ...rest, ...(code.transform !== undefined ? { transform: code.transform } : {}), spec: code.spec, template }
        }
        if (!dto.template) {
          if (dto.transform === null) {
            const { transform: _t, ...rest } = next
            next = rest
          } else if (dto.transform !== undefined) next = { ...next, transform: dto.transform }
          if (dto.spec !== undefined) next = { ...next, spec: dto.spec }
        }
        if (scope === 'shared') this.assertWidgetsShareable([next])
        return next
      })
      if (!widgets.some((w) => w.id === widgetId)) throw new Error(`Widget introuvable : ${widgetId}`)
      return { ...d, widgets }
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

  // ─── Ordre du panneau latéral ─────────────────────────────────────────────────

  async getDashboardsOrder(repoPath: string, username: string): Promise<string[]> {
    return this.readPref(repoPath, username).dashboardsOrder ?? []
  }

  async setDashboardsOrder(repoPath: string, username: string, order: string[]): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.dashboardsOrder = order
    this.writePref(repoPath, username, pref)
  }

  // ─── Dépendances (utilisées par SavedQueriesService) ──────────────────────────

  /**
   * Widgets des dashboards partagés et des dashboards privés de l'utilisateur qui utilisent
   * `queryId`. Limite connue : les dashboards privés d'un autre utilisateur ne sont pas visibles.
   * Une requête privée ne peut figurer que dans un dashboard privé : les partagés ne sont alors pas lus.
   */
  async findDependentWidgets(repoPath: string, username: string, queryId: string): Promise<DependentWidget[]> {
    const shared = isPrivateScopeId(queryId) ? [] : (await this.list(repoPath, username)).filter((d) => d.scope === 'shared')
    const priv = (this.readPref(repoPath, username).dashboards ?? []).map((raw) => this.toDashboard(readDashboardRecord(raw), 'private'))
    const out: DependentWidget[] = []
    for (const d of [...shared, ...priv]) {
      for (const w of d.widgets) {
        if (w.queryId === queryId) out.push({ dashboardId: d.id, dashboardTitle: d.title, dashboardScope: d.scope, widgetId: w.id, widgetTitle: w.title })
      }
    }
    return out
  }

  /** Après le passage en partagé d'une requête (nouvel id) : widgets des dashboards privés de
   *  l'utilisateur remappés. */
  async remapWidgetQueryId(repoPath: string, username: string, oldQueryId: string, newQueryId: string): Promise<void> {
    const pref = this.readPref(repoPath, username)
    let changed = false
    const updated = (pref.dashboards ?? []).map((raw) => {
      const d = this.toDraft(this.toDashboard(readDashboardRecord(raw), 'private'))
      if (!d.widgets.some((w) => w.queryId === oldQueryId)) return raw
      changed = true
      return this.toPrivate({ ...d, widgets: d.widgets.map((w) => (w.queryId === oldQueryId ? { ...w, queryId: newQueryId } : w)) })
    })
    if (!changed) return
    pref.dashboards = updated
    this.writePref(repoPath, username, pref)
  }

  // ─── Outils ───────────────────────────────────────────────────────────────────

  private resolveCode(dto: { transform?: string; spec?: string; template?: TemplateInput }): Pick<DraftWidget, 'transform' | 'spec' | 'template'> {
    if (dto.template) {
      const { code, template } = applyWidgetTemplate(dto.template)
      return { ...(code.transform !== undefined ? { transform: code.transform } : {}), spec: code.spec, template }
    }
    return { ...(dto.transform !== undefined ? { transform: dto.transform } : {}), spec: dto.spec ?? '{\n  "data": { "name": "rows" },\n  "mark": "bar"\n}\n' }
  }

  /** Un dashboard partagé n'embarque que des widgets dont la requête est partagée. */
  private assertWidgetsShareable(widgets: { title: string; queryId: string }[]): void {
    const offenders = widgets.filter((w) => isPrivateScopeId(w.queryId))
    if (offenders.length === 0) return
    const list = offenders.map((w) => `"${w.title}"`).join(', ')
    throw new Error(
      `Impossible de partager ce dashboard : ${offenders.length} widget(s) référencent une requête privée — ${list}. Partagez d'abord ces requêtes.`,
    )
  }

  private toDraft(d: Dashboard): Draft {
    return {
      id: d.id,
      title: d.title,
      widgetOrder: d.widgetOrder,
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      widgets: d.widgets.map((w) => ({
        id: w.id, title: w.title, queryId: w.queryId, size: w.size,
        ...(w.transform !== undefined ? { transform: w.transform } : {}),
        spec: w.spec,
        ...(w.template ? { template: w.template } : {}),
      })),
    }
  }

  private storedWidget(w: DraftWidget): StoredWidget {
    return { id: w.id, title: w.title, queryId: w.queryId, size: w.size, ...(w.template ? { template: w.template } : {}) }
  }

  private stored(d: Draft): StoredDashboard {
    return {
      id: d.id, title: d.title, formatVersion: SUIVI_FORMAT_VERSION, widgetOrder: d.widgetOrder,
      widgets: d.widgets.map((w) => this.storedWidget(w)), createdBy: d.createdBy, createdAt: d.createdAt,
    }
  }

  private toPrivate(d: Draft): Record<string, unknown> {
    const s = this.stored(d)
    return {
      ...s,
      widgets: d.widgets.map((w) => ({ ...this.storedWidget(w), ...(w.transform !== undefined ? { transform: w.transform } : {}), spec: w.spec })),
    }
  }

  private async writeShared(repoPath: string, d: Draft): Promise<void> {
    const files: Record<string, string> = { 'dashboard.yaml': toYaml(this.stored(d)) }
    for (const w of d.widgets) {
      if (w.transform !== undefined) files[`${w.id}.js`] = w.transform
      files[`${w.id}.vl.json`] = w.spec
    }
    await writeObjectFolder(repoPath, `${DIR}/${d.id}`, files)
  }

  private async removeShared(repoPath: string, id: string): Promise<void> {
    await removeSharedObject(this.git, repoPath, DIR, id)
  }

  /** Ordre du panneau latéral et valeurs des paramètres (GH93) suivent le nouvel id. */
  private renameInOrder(repoPath: string, username: string, oldId: string, newId: string): void {
    const pref = this.readPref(repoPath, username)
    const order = pref.dashboardsOrder
    const values = pref.suiviParamValues?.[oldId]
    if ((!order || !order.includes(oldId)) && !values) return
    if (order) pref.dashboardsOrder = order.map((entryId) => (entryId === oldId ? newId : entryId))
    if (values && pref.suiviParamValues) {
      delete pref.suiviParamValues[oldId]
      pref.suiviParamValues[newId] = values
    }
    this.writePref(repoPath, username, pref)
  }

  // ─── Valeurs des paramètres (GH93, toujours privées) ──────────────────────────

  /** Valeurs choisies par l'utilisateur dans la barre du dashboard (clé `name:kind`). */
  async getParamValues(repoPath: string, username: string, dashboardId: string): Promise<Record<string, GraphParamValue>> {
    return cleanParamValues(this.readPref(repoPath, username).suiviParamValues?.[dashboardId])
  }

  /** Remplace les valeurs choisies ; `null` = Réinitialiser. Jamais d'écriture dans le dashboard :
   *  autorisé sur une branche en lecture seule et pour un dashboard en lecture seule. */
  async setParamValues(repoPath: string, username: string, dashboardId: string, values: Record<string, unknown> | null): Promise<void> {
    this.writeParamValues(repoPath, username, dashboardId, values)
  }

  private writeParamValues(repoPath: string, username: string, dashboardId: string, values: Record<string, unknown> | null): void {
    const pref = this.readPref(repoPath, username)
    const all = { ...(pref.suiviParamValues ?? {}) }
    const clean = values ? cleanParamValues(values) : {}
    if (Object.keys(clean).length) all[dashboardId] = clean
    else if (dashboardId in all) delete all[dashboardId]
    else if (!values) return
    if (Object.keys(all).length) pref.suiviParamValues = all
    else delete pref.suiviParamValues
    this.writePref(repoPath, username, pref)
  }

  /** Lecture, modification et écriture d'un dashboard (privé ou partagé) au format v1. */
  private async mutate(repoPath: string, username: string, id: string, fn: (d: Draft, scope: QueryScope) => Draft): Promise<Dashboard> {
    const current = await this.get(repoPath, username, id)
    if (!current) throw new Error(`Dashboard introuvable : ${id}`)
    if (current.state.readOnly) throw readOnlyError(`Dashboard ${id}`, current.state.readOnly)
    const next = fn(this.toDraft(current), current.scope)
    if (current.scope === 'private') {
      const pref = this.readPref(repoPath, username)
      pref.dashboards = (pref.dashboards ?? []).map((d) => (d.id === id ? this.toPrivate(next) : d))
      this.writePref(repoPath, username, pref)
    } else {
      await this.writeShared(repoPath, next)
      if (current.state.legacyFormat) await dropLegacyFile(this.git, repoPath, DIR, id)
    }
    return (await this.get(repoPath, username, id))!
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

/** Valeurs au format de leur type (porté par la clé `name:kind`) ; les autres sont ignorées. Une
 *  valeur d'énumération n'est pas vérifiée ici (les valeurs déclarées peuvent changer). */
function cleanParamValues(raw: Record<string, unknown> | undefined): Record<string, GraphParamValue> {
  const out: Record<string, GraphParamValue> = {}
  for (const [key, v] of Object.entries(raw ?? {})) {
    const kind = key.slice(key.lastIndexOf(':') + 1) as QueryParameterKind
    if (!QUERY_PARAMETER_KINDS.includes(kind)) continue
    const n = normalizeParamValue({ kind: kind === 'enum' ? 'text' : kind }, v)
    if (n.ok) out[key] = n.value
  }
  return out
}
