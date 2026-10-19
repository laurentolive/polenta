import type { QueryColumnDef, QueryHistoryEntry, QueryParameterDef, QueryScope, ReadQuery, SavedQuery, StoredQuery, TemplateRef } from '@polenta/types'
import { findQueryTemplate, queryCodeForHash, readQueryRecord, SUIVI_FORMAT_VERSION, validateColumnDecl, validateParameterDecls } from '@polenta/types'
import type { GitService } from './git.service'
import type { DashboardsService } from './dashboards.service'
import { readPref as readPrefStore, writePref as writePrefStore } from './pref-store.util'
import { generatePrivateId, isPrivateScopeId } from './id-scope.util'
import { nextCounterId } from './id-counter.util'
import {
  applyQueryTemplate, computeState, dropLegacyFile, removeSharedObject, listObjectEntries, readOnlyError, readText, readYamlFile, toYaml, withHash,
  writeObjectFolder,
} from './suivi-store.util'
import type { TemplateInput } from './suivi-store.util'

export interface CreateSavedQueryDto {
  title: string
  scope: QueryScope
  createdBy: string
  /** Script fourni (objet personnalisé d'emblée)… */
  script?: string
  /** …ou modèle + paramètres : le script est généré. */
  template?: TemplateInput
  /** GH93 — paramètres choisis à l'affichage (avec `script` seulement : un modèle les génère). */
  parameters?: QueryParameterDef[]
  /** GH70 — colonne calculée de la Vue Système (requête partagée, avec `script` seulement). */
  column?: QueryColumnDef | null
}

export interface UpdateSavedQueryDto {
  title?: string
  /** Nouveau script : l'objet garde sa référence de modèle (détaché si le code diffère). */
  script?: string
  /** Nouveau modèle / nouveaux paramètres : script régénéré. `null` : retire la référence. */
  template?: TemplateInput | null
  /** GH93 — nouvelle déclaration (sans `template`) ; la requête est détachée de son modèle si elle
   *  diffère de la déclaration générée. */
  parameters?: QueryParameterDef[]
  /** GH70 — nouvelle déclaration de colonne (sans `template`) ; `null` la retire. Réservée aux
   *  requêtes partagées. */
  column?: QueryColumnDef | null
}

/** Code d'une requête : script, déclaration de paramètres (GH93), colonne (GH70), modèle éventuel. */
interface QueryCode {
  script: string
  parameters: QueryParameterDef[]
  column: QueryColumnDef | null
  template?: TemplateRef
}

export type AddHistoryEntryDto = Omit<QueryHistoryEntry, 'id' | 'executedAt'>

const DIR = 'queries'
const PREFIX = 'QUERY'

interface PrefStore {
  savedQueries?: Record<string, unknown>[]
  queryHistory?: Record<string, unknown>[]
  /** Ordre d'affichage de la section "Requêtes" du panneau latéral (préférence personnelle). */
  queriesOrder?: string[]
  [key: string]: unknown
}

/**
 * SavedQueriesService — requêtes de la vue Suivi (GH74 : scripts de données). Partagé :
 * `queries/QUERY-xxxx/{query.yaml,script.js}` (ID via `nextCounterId`, pierre tombale à la
 * suppression ou au passage en privé) ; privé : clé `savedQueries` du `.{username}.pref`.
 * Format d'avant GH74 (`queries/QUERY-xxxx.yaml`, `mode` builder / sql) lu et converti en mémoire,
 * réécrit au format v1 à la première modification. Une requête en lecture seule (SQL d'avant GH74,
 * format plus récent) n'est jamais réécrite.
 *
 * `dashboards` détecte les widgets dépendants (suppression / passage en privé bloqués).
 */
export class SavedQueriesService {
  constructor(
    private readonly git: GitService,
    private readonly dashboards?: DashboardsService,
  ) {}

  // ─── Lecture ──────────────────────────────────────────────────────────────────

  async list(repoPath: string, username: string): Promise<SavedQuery[]> {
    const priv = (this.readPref(repoPath, username).savedQueries ?? []).map((raw) => this.toQuery(readQueryRecord(raw), 'private'))
    const entries = await listObjectEntries(repoPath, DIR, PREFIX)
    const shared = (await Promise.all(entries.map((e) => this.readShared(repoPath, e.id)))).filter((q): q is SavedQuery => q !== null)
    return [...priv, ...shared].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async findOne(repoPath: string, username: string, id: string): Promise<SavedQuery | null> {
    if (isPrivateScopeId(id)) {
      const raw = this.readPref(repoPath, username).savedQueries?.find((q) => q.id === id)
      return raw ? this.toQuery(readQueryRecord(raw), 'private') : null
    }
    return this.readShared(repoPath, id)
  }

  private async readShared(repoPath: string, id: string): Promise<SavedQuery | null> {
    const folder = await readYamlFile<Record<string, unknown>>(repoPath, `${DIR}/${id}/query.yaml`)
    if (folder) return this.toQuery(readQueryRecord(folder, await readText(repoPath, `${DIR}/${id}/script.js`) ?? ''), 'shared')
    const legacy = await readYamlFile<Record<string, unknown>>(repoPath, `${DIR}/${id}.yaml`)
    return legacy ? this.toQuery(readQueryRecord(legacy), 'shared') : null
  }

  private toQuery(r: ReadQuery, scope: QueryScope): SavedQuery {
    const { decls: parameters, errors } = validateParameterDecls(r.parameters)
    const checkedColumn = validateColumnDecl(r.column)
    // GH70 — une requête privée ne porte pas de colonne (`.pref` édité à la main) : signalée, ignorée.
    const columnErrors = scope === 'private' && checkedColumn.decl ? [COLUMN_PRIVATE_MESSAGE] : checkedColumn.errors
    const column = columnErrors.length ? null : checkedColumn.decl
    const hashed = queryCodeForHash(r.script, parameters, column)
    const template = r.template ? withHash(r.template, hashed) : undefined
    return {
      id: r.id,
      title: r.title,
      scope,
      formatVersion: r.formatVersion,
      script: r.script,
      ...(template ? { template } : {}),
      parameters,
      ...(errors.length ? { parametersError: errors.join(' ; ') } : {}),
      column,
      ...(columnErrors.length ? { columnError: columnErrors.join(' ; ') } : {}),
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      ...(r.legacySql !== undefined ? { legacySql: r.legacySql } : {}),
      state: computeState(r.template, hashed, 'query', { readOnly: r.readOnly, legacyFormat: r.legacyFormat }),
    }
  }

  // ─── Écriture ─────────────────────────────────────────────────────────────────

  async create(repoPath: string, username: string, dto: CreateSavedQueryDto): Promise<SavedQuery> {
    const code = this.resolveCode(dto.script, dto.template, dto.parameters, dto.column)
    if (dto.scope === 'private' && code.column) throw columnPrivateError()
    const base = { title: dto.title, createdBy: dto.createdBy, createdAt: new Date().toISOString(), ...code }
    if (dto.scope === 'shared') {
      const id = await nextCounterId(this.git, repoPath, PREFIX, DIR)
      if (await this.git.fileExists(repoPath, `${DIR}/${id}`)) throw new Error(`${id} already exists`)
      await this.writeShared(repoPath, { id, ...base })
      return (await this.readShared(repoPath, id))!
    }
    const pref = this.readPref(repoPath, username)
    const stored = this.toStored({ id: generatePrivateId(), ...base })
    pref.savedQueries = [...(pref.savedQueries ?? []), { ...stored, script: base.script }]
    this.writePref(repoPath, username, pref)
    return this.toQuery(readQueryRecord({ ...stored, script: base.script }), 'private')
  }

  /**
   * `replaceLegacy` (mise à niveau des seeds, GH74) : une requête SQL d'avant GH74 reconnue est
   * remplacée par sa définition actuelle, sous le même id. Jamais pour un format plus récent.
   */
  async update(repoPath: string, username: string, id: string, dto: UpdateSavedQueryDto, opts: { replaceLegacy?: boolean } = {}): Promise<SavedQuery> {
    const current = await this.findOne(repoPath, username, id)
    if (!current) throw new Error(`Requête introuvable : ${id}`)
    const replacing = opts.replaceLegacy && current.state.readOnly === 'legacy-sql' && !!dto.template
    if (current.state.readOnly && !replacing) throw readOnlyError(`Requête ${id}`, current.state.readOnly)
    if (dto.template && dto.parameters !== undefined) throw paramsError(['parameters est généré par le modèle : ne pas le fournir avec template'])
    if (dto.template && dto.column !== undefined) throw columnError(['column est générée par le modèle : ne pas la fournir avec template'])
    let script = current.script
    let template: TemplateRef | undefined = current.template
    let parameters = current.parameters
    let column = current.column
    if (dto.template === null) template = undefined
    else if (dto.template) ({ script, parameters, column, template } = applyQueryTemplate(dto.template))
    if (dto.script !== undefined && !dto.template) script = dto.script
    if (dto.parameters !== undefined) parameters = checkedParameters(dto.parameters)
    // Déclaration lue invalide et non remplacée : la réécrire vide la perdrait.
    else if (current.parametersError && !dto.template) throw paramsError([current.parametersError])
    if (dto.column !== undefined) column = checkedColumn(dto.column)
    else if (current.columnError && current.scope === 'shared' && !dto.template) throw columnError([current.columnError])
    if (current.scope === 'private' && column) throw columnPrivateError()
    const next = { id, title: dto.title ?? current.title, createdBy: current.createdBy, createdAt: current.createdAt, script, parameters, column, template }

    if (current.scope === 'private') {
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = (pref.savedQueries ?? []).map((q) => (q.id === id ? { ...this.toStored(next), script } : q))
      this.writePref(repoPath, username, pref)
      return (await this.findOne(repoPath, username, id))!
    }
    await this.writeShared(repoPath, next)
    // Format d'avant GH74 : le dossier v1 remplace le fichier (même id, pas de pierre tombale).
    if (current.state.legacyFormat) await dropLegacyFile(this.git, repoPath, DIR, id)
    return (await this.readShared(repoPath, id))!
  }

  async delete(repoPath: string, username: string, id: string): Promise<void> {
    await this.assertNoDependents(repoPath, username, id, 'supprimer')
    if (isPrivateScopeId(id)) {
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = (pref.savedQueries ?? []).filter((q) => q.id !== id)
      this.writePref(repoPath, username, pref)
      return
    }
    await this.removeShared(repoPath, id)
  }

  /**
   * Passage privé → partagé (toujours libre ; les widgets des dashboards privés du même utilisateur
   * qui la référençaient suivent le nouvel id) ou partagé → privé (bloqué si des widgets en
   * dépendent). L'id change (schémas d'id différents). L'ordre du panneau latéral suit.
   */
  async setScope(repoPath: string, username: string, id: string, newScope: QueryScope): Promise<SavedQuery> {
    const current = await this.findOne(repoPath, username, id)
    if (!current) throw new Error(`Requête introuvable : ${id}`)
    if (current.scope === newScope) return current
    if (current.state.readOnly) throw readOnlyError(`Requête ${id}`, current.state.readOnly)

    if (current.parametersError) throw paramsError([current.parametersError])
    // GH70 — une colonne est réservée aux requêtes partagées : retirée au passage en privé
    // (confirmation côté UI) ; une déclaration lue invalide n'est pas recopiée.
    // Un modèle qui génère une colonne ne peut pas s'appliquer à une requête privée : sa référence
    // est retirée aussi (la copie privée est un script personnalisé).
    const column = newScope === 'shared' ? current.column : null
    const template = newScope === 'private' && current.template && findQueryTemplate(current.template.id)?.column ? undefined : current.template
    const payload = { title: current.title, createdBy: current.createdBy, createdAt: current.createdAt, script: current.script, parameters: current.parameters, column, template }
    let moved: SavedQuery
    if (newScope === 'private') {
      await this.assertNoDependents(repoPath, username, id, 'repasser en privé')
      await this.removeShared(repoPath, id)
      const newId = generatePrivateId()
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = [...(pref.savedQueries ?? []), { ...this.toStored({ id: newId, ...payload }), script: payload.script }]
      this.writePref(repoPath, username, pref)
      moved = (await this.findOne(repoPath, username, newId))!
    } else {
      // Partagé écrit AVANT de retirer le privé : un échec en route ne perd jamais la requête.
      const newId = await nextCounterId(this.git, repoPath, PREFIX, DIR)
      await this.writeShared(repoPath, { id: newId, ...payload })
      const pref = this.readPref(repoPath, username)
      pref.savedQueries = (pref.savedQueries ?? []).filter((q) => q.id !== id)
      this.writePref(repoPath, username, pref)
      if (this.dashboards) await this.dashboards.remapWidgetQueryId(repoPath, username, id, newId)
      moved = (await this.readShared(repoPath, newId))!
    }
    this.renameInOrder(repoPath, username, id, moved.id)
    return moved
  }

  private resolveCode(script: string | undefined, template: TemplateInput | undefined, parameters: QueryParameterDef[] | undefined, column: QueryColumnDef | null | undefined): QueryCode {
    if (template) {
      if (parameters !== undefined) throw paramsError(['parameters est généré par le modèle : ne pas le fournir avec template'])
      if (column !== undefined) throw columnError(['column est générée par le modèle : ne pas la fournir avec template'])
      return applyQueryTemplate(template)
    }
    return { script: script ?? 'export default (data, polenta) => []\n', parameters: checkedParameters(parameters), column: checkedColumn(column) }
  }

  private toStored(q: { id: string; title: string; createdBy: string; createdAt: string; parameters?: QueryParameterDef[]; column?: QueryColumnDef | null; template?: TemplateRef }): StoredQuery {
    return {
      id: q.id,
      title: q.title,
      formatVersion: SUIVI_FORMAT_VERSION,
      ...(q.template ? { template: q.template } : {}),
      ...(q.parameters?.length ? { parameters: q.parameters } : {}),
      ...(q.column ? { column: q.column } : {}),
      createdBy: q.createdBy,
      createdAt: q.createdAt,
    }
  }

  private async writeShared(repoPath: string, q: { id: string; title: string; createdBy: string; createdAt: string; script: string; parameters?: QueryParameterDef[]; column?: QueryColumnDef | null; template?: TemplateRef }): Promise<void> {
    await writeObjectFolder(repoPath, `${DIR}/${q.id}`, {
      'query.yaml': toYaml(this.toStored(q)),
      'script.js': q.script,
    })
  }

  private async removeShared(repoPath: string, id: string): Promise<void> {
    await removeSharedObject(this.git, repoPath, DIR, id)
  }

  /** Garde l'ordre du panneau latéral sur le nouvel id après un changement de portée. */
  private renameInOrder(repoPath: string, username: string, oldId: string, newId: string): void {
    const pref = this.readPref(repoPath, username)
    const order = pref.queriesOrder
    if (!order || !order.includes(oldId)) return
    pref.queriesOrder = order.map((entryId) => (entryId === oldId ? newId : entryId))
    this.writePref(repoPath, username, pref)
  }

  /** Lève, en listant les widgets / dashboards dépendants, s'il en existe. */
  private async assertNoDependents(repoPath: string, username: string, id: string, action: string): Promise<void> {
    if (!this.dashboards) return
    const dependents = await this.dashboards.findDependentWidgets(repoPath, username, id)
    if (dependents.length === 0) return
    const list = dependents
      .map((d) => `"${d.widgetTitle}" (dashboard "${d.dashboardTitle}", ${d.dashboardScope === 'shared' ? 'partagé' : 'privé'})`)
      .join(', ')
    throw new Error(`Impossible de ${action} cette requête : utilisée par ${dependents.length} widget(s) — ${list}.`)
  }

  // ─── Historique (toujours privé) ──────────────────────────────────────────────

  async addHistoryEntry(repoPath: string, username: string, entry: AddHistoryEntryDto): Promise<QueryHistoryEntry> {
    const pref = this.readPref(repoPath, username)
    // Ré-exécuter un script déjà présent ne crée pas de doublon : l'entrée remonte en tête.
    const list = this.history(pref).filter((e) => e.script !== entry.script)
    const full: QueryHistoryEntry = {
      script: entry.script,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      executedAt: new Date().toISOString(),
    }
    pref.queryHistory = [full, ...list] as unknown as Record<string, unknown>[]
    this.writePref(repoPath, username, pref)
    return full
  }

  /** Entrées de l'historique ; celles d'avant GH74 (`mode` builder / sql) sont ignorées. */
  async listHistory(repoPath: string, username: string): Promise<QueryHistoryEntry[]> {
    return this.history(this.readPref(repoPath, username))
  }

  async deleteHistoryEntry(repoPath: string, username: string, id: string): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.queryHistory = (pref.queryHistory ?? []).filter((e) => e.id !== id)
    this.writePref(repoPath, username, pref)
  }

  private history(pref: PrefStore): QueryHistoryEntry[] {
    return (pref.queryHistory ?? []).filter((e): e is QueryHistoryEntry & Record<string, unknown> => typeof e.script === 'string') as QueryHistoryEntry[]
  }

  // ─── Ordre du panneau latéral ─────────────────────────────────────────────────

  async getQueriesOrder(repoPath: string, username: string): Promise<string[]> {
    return this.readPref(repoPath, username).queriesOrder ?? []
  }

  async setQueriesOrder(repoPath: string, username: string, order: string[]): Promise<void> {
    const pref = this.readPref(repoPath, username)
    pref.queriesOrder = order
    this.writePref(repoPath, username, pref)
  }

  private readPref(repoPath: string, username: string): PrefStore {
    return readPrefStore(repoPath, username) as PrefStore
  }

  private writePref(repoPath: string, username: string, data: PrefStore): void {
    writePrefStore(repoPath, username, data)
  }
}

/** Déclaration validée (GH93), sinon erreur `[PARAMS_INVALID]` listant les problèmes. */
function checkedParameters(raw: QueryParameterDef[] | undefined): QueryParameterDef[] {
  const { decls, errors } = validateParameterDecls(raw)
  if (errors.length) throw paramsError(errors)
  return decls
}

function paramsError(errors: string[]): Error {
  return new Error(`[PARAMS_INVALID] Déclaration de paramètres invalide : ${errors.join(' ; ')}.`)
}

const COLUMN_PRIVATE_MESSAGE = 'colonne calculée réservée aux requêtes partagées'

/** GH70 — déclaration de colonne validée (`null` = aucune), sinon erreur `[COLUMN_INVALID]`. */
function checkedColumn(raw: QueryColumnDef | null | undefined): QueryColumnDef | null {
  const { decl, errors } = validateColumnDecl(raw)
  if (errors.length) throw columnError(errors)
  return decl
}

function columnError(errors: string[]): Error {
  return new Error(`[COLUMN_INVALID] Déclaration de colonne invalide : ${errors.join(' ; ')}.`)
}

function columnPrivateError(): Error {
  return new Error(`[COLUMN_PRIVATE] Une ${COLUMN_PRIVATE_MESSAGE} : enregistrer la requête en partagé, ou retirer la déclaration.`)
}
