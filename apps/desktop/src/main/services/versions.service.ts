import * as path from 'path'
import * as yaml from 'js-yaml'
import type {
  CreateVersionDto, ObjectTypeDefinition, ProductVersion, ProjectSchema, UpdateVersionDto, VersionBacklogItem,
  VersionChange, VersionChangeRow, VersionComponentNode, VersionElementRef, VersionErrorCode, VersionPage,
  VersionProblem, VersionReleasePreview, VersionSummary, WorkspaceTreeNode,
  ImpactAnalysisStatus, VersionAnalysis, VersionImpacted, VersionTestsToRun,
} from '@polenta/types'
import { IMPACT_ANALYSIS_STATUSES, initialStatus, isUnknownStatus, isValidTagName, suggestVersionTag, versionState } from '@polenta/types'
import type { GitService } from './git.service'
import type { SyncService } from './sync.service'
import type { SchemaService } from './schema.service'
import type { HistoryService } from './history.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { ElementState, VersionTrackingService } from './version-tracking.service'
import { ELEMENT_DIRS } from './version-tracking.service'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'
import { declaresRef, repoKey } from './schema-refs.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { applyFieldsWrite } from './field-write.util'
import type { ImpactSnapshot, TraceabilityService } from './traceability.service'
import type { CampaignsService } from './campaigns.service'
import { computeVersionAnalysis, computeVersionTests } from './version-analysis.util'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

/** Erreur métier des versions : le message commence par le code (`TAG_EXISTS: …`), traduit par le renderer. */
export class VersionError extends Error {
  constructor(readonly code: VersionErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'VersionError'
  }
}

interface VersionType { typeDef: ObjectTypeDefinition; ref: string }
interface RepoInfo { name: string; label: string; repoPath: string }
interface ElementRow { state: ElementState; category: 'requirement' | 'test'; filePath: string }

const VERSIONS_DIR = 'versions'
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true })

/**
 * GH201 — versions d'un composant (un repo) ou du produit (repo racine) : objet `versions/<ID>.yaml`,
 * backlog des changements, page (composants, changements), passage released (commit + tag).
 * Plusieurs versions peuvent être en cours dans un repo ; une version released est verrouillée.
 */
export class VersionsService {
  constructor(
    private readonly git: GitService,
    private readonly sync: Pick<SyncService, 'commitSingleFile' | 'createAnnotatedTag' | 'resolveHead' | 'queueTagPush'>,
    private readonly schema: Pick<SchemaService, 'get'>,
    private readonly tracking: VersionTrackingService,
    private readonly history?: HistoryService,
    private readonly workspaceTree?: WorkspaceTreeService,
    /** Repos montés sous un nœud `readonly` du repo racine (`RevalidationService.readonlyRepoPaths`). */
    private readonly schemaReadonlyRepos?: (rootRepoPath: string, workspaceDir: string) => Promise<Set<string>>,
  ) {}

  private writeQueues = new Map<string, Promise<unknown>>()
  private impactSources?: {
    traceability: Pick<TraceabilityService, 'loadWorkingTreeSnapshot' | 'buildImpactTreesFromSnapshot'>
    campaigns: Pick<CampaignsService, 'list'>
  }

  /** GH245 — moteur d'impact et campagnes (injectés après construction, comme `GraphService.setVersions`). */
  setImpactSources(sources: NonNullable<VersionsService['impactSources']>): void {
    this.impactSources = sources
  }

  /** Sérialise les écritures d'un même repo (une seule version en cours : contrôle puis écriture). */
  private enqueue<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
    const key = repoKey(repoPath)
    const prev = this.writeQueues.get(key) ?? Promise.resolve()
    const run = prev.then(task, task)
    this.writeQueues.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  /** Type version du repo (nœud `root`), null si le repo n'en déclare pas. */
  async versionType(repoPath: string): Promise<VersionType | null> {
    const schema = await this.schema.get(repoPath).catch(() => null as ProjectSchema | null)
    const root = schema?.nodes?.find(n => n.name === 'root')
    const typeDef = root?.objectTypes?.find(t => t.category === 'version')
    return typeDef ? { typeDef, ref: `root::${typeDef.name}` } : null
  }

  /** Versions du repo (`versions/<ID>.yaml` à plat), par ID croissant. */
  async list(repoPath: string): Promise<ProductVersion[]> {
    // `versions/<REQ>/vN.yaml` (instantanés historiques de `RequirementsIndexService`) : sous-dossiers, ignorés.
    const files = (await this.git.listFiles(repoPath, VERSIONS_DIR).catch(() => []))
      .filter(f => f.endsWith('.yaml') && f.split('/').length === 2)
    const out: ProductVersion[] = []
    for (const file of files) {
      const v = await this.git.readYaml<ProductVersion>(repoPath, file).catch(() => null)
      if (v?.id) out.push({ ...v, fields: v.fields ?? {} })
    }
    return out.sort(byId)
  }

  async get(repoPath: string, id: string): Promise<ProductVersion> {
    const v = await this.git.readYaml<ProductVersion>(repoPath, `${VERSIONS_DIR}/${id}.yaml`).catch(() => null)
    if (!v?.id) throw new VersionError('VERSION_NOT_FOUND', id)
    return { ...v, fields: v.fields ?? {} }
  }

  async summaries(repoPath: string): Promise<VersionSummary[]> {
    const vt = await this.versionType(repoPath)
    return (await this.list(repoPath)).map(v => this.summary(vt?.typeDef ?? null, v))
  }

  private summary(typeDef: ObjectTypeDefinition | null, v: ProductVersion): VersionSummary {
    return {
      id: v.id, title: v.title, status: v.status, state: versionState(typeDef, v.status),
      ...(v.basedOn && { basedOn: v.basedOn }), ...(v.freeze && { freeze: v.freeze }),
      ...(v.components && { components: v.components }),
    }
  }

  /** Arbre du sous-panneau Produit : repo racine puis ses dépendances (récursif). */
  async tree(rootRepoPath: string, workspaceDir?: string): Promise<VersionComponentNode[]> {
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const readonly = await this.readonlyKeys(rootRepoPath, workspaceDir)
    const build = async (node: WorkspaceTreeNode): Promise<VersionComponentNode> => {
      const vt = await this.versionType(node.repoPath)
      const versions = vt ? (await this.list(node.repoPath)).map(v => this.summary(vt.typeDef, v)).reverse() : []
      return {
        name: node.name, label: node.label || node.name, repoPath: node.repoPath,
        readonly: readonly.has(repoKey(node.repoPath)),
        versionType: vt ? { ref: vt.ref, label: vt.typeDef.label || vt.typeDef.name } : null,
        versions,
        backlogCount: vt ? (await this.backlog(node.repoPath)).length : 0,
        children: await Promise.all(node.children.map(build)),
      }
    }
    const root: WorkspaceTreeNode = ws?.logicalTree ?? {
      name: path.basename(rootRepoPath), repoPath: rootRepoPath, url: '', pin: '', isInterface: false, children: [],
    }
    return [await build(root)]
  }

  /**
   * GH201 §7 — statut de design : pour chaque exigence du repo, première version released (ordre
   * des livraisons) dont l'état figé contient l'exigence dans sa `version` courante.
   */
  async designVersions(repoPath: string): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const vt = await this.versionType(repoPath)
    if (!vt) return out
    const released = releasedInOrder(vt.typeDef, await this.list(repoPath))
    if (released.length === 0) return out
    for (const el of await this.elements(repoPath, 'requirement')) {
      for (const v of released) {
        const at = await this.tracking.readAt(repoPath, v.freeze!.sha, el.filePath)
        if (at?.version === el.state.version) { out.set(el.state.id, v.id); break }
      }
    }
    return out
  }

  // ── Backlog ────────────────────────────────────────────────────────────────

  /**
   * GH201 §4 — exigences et tests dont un changement n'a jamais été inclus dans une version :
   * jamais livrés (hors terminaux), ou modifiés depuis l'état figé de la dernière version released
   * qui les incluait ; hors version en cours. Approuvés modifiés hors interface signalés.
   */
  async backlog(repoPath: string): Promise<VersionBacklogItem[]> {
    const [versions, vt, schema, elements] = await Promise.all([
      this.list(repoPath), this.versionType(repoPath), this.schema.get(repoPath).catch(() => null), this.elements(repoPath),
    ])
    const typeDef = vt?.typeDef ?? null
    const included = new Set(versions
      .filter(v => versionState(typeDef, v.status) === 'in_progress')
      .flatMap(v => (v.changes ?? []).map(c => c.id)))
    const lastIncl = this.lastInclusions(typeDef, versions)
    const items = new Map<string, VersionBacklogItem>()
    for (const el of elements) {
      if (included.has(el.state.id)) continue
      const item = (kind: 'new' | 'modified', base?: VersionElementRef): VersionBacklogItem => ({
        id: el.state.id, title: el.state.title, category: el.category, status: el.state.status,
        objectTypeRef: el.state.objectTypeRef, kind, ...(base && { base }), filePath: el.filePath,
      })
      const v = lastIncl.get(el.state.id)
      if (!v?.freeze) {
        if (!isTerminal(schema, el.state)) items.set(el.state.id, item('new'))
        continue
      }
      const at = await this.tracking.readAt(repoPath, v.freeze.sha, el.filePath)
      if (at?.key !== el.state.key) items.set(el.state.id, item('modified', at ? { sha: v.freeze.sha, version: at.version } : undefined))
    }
    for (const o of await this.tracking.outsideModifications(repoPath).catch(() => [])) {
      if (included.has(o.id)) continue
      const outside = { approvedSha: o.approvedSha, dirty: o.dirty }
      const existing = items.get(o.id)
      if (existing) { existing.outside = outside; continue }
      const el = elements.find(e => e.state.id === o.id)
      if (!el) continue
      const base = await this.baseFrom(repoPath, lastIncl.get(o.id), el.filePath)
      items.set(o.id, {
        id: o.id, title: el.state.title, category: el.category, status: el.state.status, objectTypeRef: el.state.objectTypeRef,
        kind: 'modified', ...(base && { base }), outside, filePath: el.filePath,
      })
    }
    return [...items.values()].sort(byId)
  }

  /** Dernière version released (ordre des livraisons) qui inclut chaque élément. */
  private lastInclusions(typeDef: ObjectTypeDefinition | null, versions: ProductVersion[]): Map<string, ProductVersion> {
    const last = new Map<string, ProductVersion>()
    for (const v of releasedInOrder(typeDef, versions)) {
      for (const c of v.changes ?? []) last.set(c.id, v)
    }
    return last
  }

  private async baseFrom(repoPath: string, v: ProductVersion | undefined, filePath: string): Promise<VersionElementRef | undefined> {
    if (!v?.freeze) return undefined
    const at = await this.tracking.readAt(repoPath, v.freeze.sha, filePath)
    return at ? { sha: v.freeze.sha, version: at.version } : undefined
  }

  /**
   * Exigences et tests du composant (ou une seule catégorie), lus sur disque : un fichier dont le type
   * n'est pas déclaré par le schéma du repo appartient à un autre composant (copie, reliquat) et n'en
   * fait pas partie.
   */
  private async elements(repoPath: string, only?: ElementRow['category']): Promise<ElementRow[]> {
    const own = await this.ownership(repoPath)
    const out: ElementRow[] = []
    for (const [dir, category] of ELEMENT_DIRS) {
      if (only && category !== only) continue
      const files = (await this.git.listFiles(repoPath, dir).catch(() => [])).filter(f => f.endsWith('.yaml') && f.split('/').length === 2)
      for (const filePath of files) {
        const state = await this.tracking.readDisk(repoPath, filePath)
        if (state && own(state)) out.push({ state, category, filePath })
      }
    }
    return out
  }

  private async elementFile(repoPath: string, id: string): Promise<{ filePath: string; category: 'requirement' | 'test'; state: ElementState } | null> {
    for (const [dir, category] of ELEMENT_DIRS) {
      const filePath = `${dir}/${id}.yaml`
      const state = await this.tracking.readDisk(repoPath, filePath)
      if (state) return { filePath, category, state }
    }
    return null
  }

  /** L'élément est-il du composant (type déclaré par le schéma du repo) ? Schéma illisible : oui. */
  private async ownership(repoPath: string): Promise<(el: ElementState) => boolean> {
    const schema = await this.schema.get(repoPath).catch(() => null)
    return el => !schema || declaresRef(schema, el.objectTypeRef)
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  async create(repoPath: string, dto: CreateVersionDto, workspaceDir?: string): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.versionType(repoPath)
      if (!vt) throw new VersionError('NO_VERSION_TYPE', path.basename(repoPath))
      if (!vt.typeDef.prefix) throw new VersionError('NO_VERSION_TYPE', `${vt.ref} : préfixe manquant`)
      const versions = await this.list(repoPath)
      const title = this.assertLabel(vt.typeDef, versions, dto.title)
      // Absent : dernière version released du repo (pré-remplissage §2) ; `null` : aucune.
      const lastReleased = releasedInOrder(vt.typeDef, versions).at(-1)?.id ?? null
      const basedOn = this.assertBasedOn(vt.typeDef, versions, dto.basedOn === undefined ? lastReleased : dto.basedOn, null)
      const id = await nextCounterId(this.git, repoPath, vt.typeDef.prefix, VERSIONS_DIR)
      const filePath = `${VERSIONS_DIR}/${id}.yaml`
      await assertNewObjectFile(this.git, repoPath, filePath, id)
      const components = cleanComponents(dto.components)
      const created: ProductVersion = {
        id, objectTypeRef: vt.ref, title, status: initialStatus(vt.typeDef), version: 1,
        ...(basedOn && { basedOn }), ...(components && { components }), changes: [],
        fields: dto.fields ?? {},
      }
      const stamped = await this.stamp(repoPath, null, await applyFieldsWrite(this.git, repoPath, null, created), filePath)
      await this.git.writeYaml(repoPath, filePath, stamped)
      return stamped
    })
  }

  /**
   * Copie d'une version dans son repo : nouvelle version en cours, mêmes `basedOn`, `components`,
   * `fields` et éléments inclus (`base` recalculée) ; ni `freeze`, ni historique.
   */
  async copy(repoPath: string, id: string, workspaceDir?: string): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.versionType(repoPath)
      if (!vt?.typeDef.prefix) throw new VersionError('NO_VERSION_TYPE', path.basename(repoPath))
      const source = await this.get(repoPath, id)
      const versions = await this.list(repoPath)
      const taken = new Set(versions.filter(v => versionState(vt.typeDef, v.status) !== 'abandoned').map(v => v.title))
      let title = `${source.title} (copie)`
      for (let n = 2; taken.has(title); n++) title = `${source.title} (copie ${n})`
      const lastIncl = this.lastInclusions(vt.typeDef, versions)
      const changes: VersionChange[] = []
      for (const c of source.changes ?? []) {
        const el = await this.elementFile(repoPath, c.id)
        const base = el ? await this.baseFrom(repoPath, lastIncl.get(c.id), el.filePath) : undefined
        changes.push({ id: c.id, ...(base && { base }) })
      }
      const newId = await nextCounterId(this.git, repoPath, vt.typeDef.prefix, VERSIONS_DIR)
      const filePath = `${VERSIONS_DIR}/${newId}.yaml`
      await assertNewObjectFile(this.git, repoPath, filePath, newId)
      const copied: ProductVersion = {
        id: newId, objectTypeRef: vt.ref, title, status: initialStatus(vt.typeDef), version: 1,
        ...(source.basedOn && { basedOn: source.basedOn }), ...(source.components && { components: source.components }),
        changes, fields: source.fields ?? {},
      }
      const stamped = await this.stamp(repoPath, null, copied, filePath)
      await this.git.writeYaml(repoPath, filePath, stamped)
      return stamped
    })
  }

  /** Supprime une version jamais livrée (pierre tombale GH20) ; une version figée porte un tag : on l'abandonne. */
  async delete(repoPath: string, id: string, workspaceDir?: string): Promise<void> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
      const existing = await this.get(repoPath, id)
      if (existing.freeze || versionState(typeDef, existing.status) === 'released') throw new VersionError('VERSION_LOCKED', id)
      await deleteWithTombstone(this.git, repoPath, `${VERSIONS_DIR}/${id}.yaml`, id)
    })
  }

  async update(repoPath: string, id: string, dto: UpdateVersionDto, workspaceDir?: string): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.versionType(repoPath)
      const typeDef = vt?.typeDef ?? null
      const existing = await this.get(repoPath, id)
      const from = versionState(typeDef, existing.status)
      const to = dto.status !== undefined ? versionState(typeDef, dto.status) : from
      if (dto.status !== undefined && isUnknownStatus(typeDef, dto.status)) throw new VersionError('STATUS_UNKNOWN', dto.status)
      if (dto.status !== undefined && dto.status !== existing.status && to === 'released') {
        throw new VersionError('RELEASE_REQUIRED', id)
      }
      // Released ou abandonnée : verrouillée comme un élément approuvé. Une released peut seulement
      // être abandonnée ; une abandonnée ne revient pas en cours.
      if (from !== 'in_progress') {
        const statusChange = dto.status !== undefined && dto.status !== existing.status
        if ((statusChange && !(from === 'released' && to === 'abandoned')) || !sameContent(existing, dto)) {
          throw new VersionError('VERSION_LOCKED', id)
        }
      }
      const versions = (await this.list(repoPath)).filter(v => v.id !== id)
      const updated: ProductVersion = { ...existing }
      if (from === 'in_progress' && dto.title !== undefined) updated.title = this.assertLabel(typeDef, versions, dto.title)
      if (dto.basedOn !== undefined) {
        const basedOn = this.assertBasedOn(typeDef, versions, dto.basedOn, id)
        if (basedOn) updated.basedOn = basedOn
        else delete updated.basedOn
      }
      if (dto.components !== undefined) {
        const components = cleanComponents(dto.components)
        if (components) updated.components = components
        else delete updated.components
      }
      if (dto.fields !== undefined) updated.fields = { ...existing.fields, ...dto.fields }
      if (dto.status !== undefined) updated.status = dto.status
      const filePath = `${VERSIONS_DIR}/${id}.yaml`
      const stamped = await this.stamp(repoPath, existing, await applyFieldsWrite(this.git, repoPath, existing, updated), filePath)
      await this.git.writeYaml(repoPath, filePath, stamped)
      return stamped
    })
  }

  /** Inclut des éléments du repo dans la version en cours ; `base` = état dans la dernière version released qui les incluait. */
  async include(repoPath: string, id: string, elementIds: string[], workspaceDir?: string): Promise<ProductVersion> {
    return this.mutateChanges(repoPath, id, workspaceDir, async (v, typeDef) => {
      const versions = await this.list(repoPath)
      const lastIncl = this.lastInclusions(typeDef, versions)
      const own = await this.ownership(repoPath)
      const changes = [...(v.changes ?? [])]
      const present = new Set(changes.map(c => c.id))
      for (const elementId of elementIds) {
        if (present.has(elementId)) continue
        const el = await this.elementFile(repoPath, elementId)
        if (!el) continue
        if (!own(el.state)) throw new VersionError('NOT_OWN_ELEMENT', elementId)
        const base = await this.baseFrom(repoPath, lastIncl.get(elementId), el.filePath)
        changes.push({ id: elementId, ...(base && { base }) })
        present.add(elementId)
      }
      return changes
    })
  }

  async removeChanges(repoPath: string, id: string, elementIds: string[], workspaceDir?: string): Promise<ProductVersion> {
    const removed = new Set(elementIds)
    return this.mutateChanges(repoPath, id, workspaceDir, async v => (v.changes ?? []).filter(c => !removed.has(c.id)))
  }

  private mutateChanges(
    repoPath: string, id: string, workspaceDir: string | undefined,
    fn: (v: ProductVersion, typeDef: ObjectTypeDefinition | null) => Promise<VersionChange[]>,
  ): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
      const existing = await this.get(repoPath, id)
      if (versionState(typeDef, existing.status) !== 'in_progress') throw new VersionError('NOT_IN_PROGRESS', id)
      const updated = { ...existing, changes: await fn(existing, typeDef) }
      const filePath = `${VERSIONS_DIR}/${id}.yaml`
      const stamped = await this.stamp(repoPath, existing, updated, filePath)
      await this.git.writeYaml(repoPath, filePath, stamped)
      return stamped
    })
  }

  // ── Page ───────────────────────────────────────────────────────────────────

  async page(repoPath: string, id: string, workspaceDir?: string): Promise<VersionPage> {
    const vt = await this.versionType(repoPath)
    if (!vt) throw new VersionError('NO_VERSION_TYPE', path.basename(repoPath))
    const versions = await this.list(repoPath)
    const version = versions.find(v => v.id === id)
    if (!version) throw new VersionError('VERSION_NOT_FOUND', id)
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const info = this.repoInfo(repoPath, ws?.nodes ?? [])
    const readonly = await this.isReadonly(repoPath, workspaceDir)
    const summary = (v: ProductVersion) => this.summary(vt.typeDef, v)
    const basedOnVersion = version.basedOn ? versions.find(v => v.id === version.basedOn) : undefined

    const deps = this.dependencies(repoPath, ws?.logicalTree ?? null)
    const components = await Promise.all(deps.map(async dep => {
      const depVt = await this.versionType(dep.repoPath)
      const depVersions = depVt ? (await this.list(dep.repoPath)).map(v => this.summary(depVt.typeDef, v)) : []
      const selectedId = version.components?.[dep.name]
      return {
        name: dep.name, label: dep.label, repoPath: dep.repoPath, versionType: !!depVt,
        selected: depVersions.find(v => v.id === selectedId) ?? null,
        options: depVersions.filter(v => v.state !== 'abandoned').reverse(),
      }
    }))

    const rows = await this.rowsOf(info, version, basedOnVersion, ws?.nodes ?? [], ws?.logicalTree ?? null, new Set(), true)
    return {
      version, state: versionState(vt.typeDef, version.status),
      component: { ...info, readonly },
      typeDef: vt.typeDef,
      basedOn: basedOnVersion ? summary(basedOnVersion) : null,
      basedOnOptions: versions.filter(v => v.id !== id && versionState(vt.typeDef, v.status) === 'released').map(summary).reverse(),
      components,
      rows,
    }
  }

  /** Lignes de changements : celles de `v`, puis celles des versions des dépendances postérieures à `basedOn`. */
  private async rowsOf(
    info: RepoInfo, v: ProductVersion, basedOnVersion: ProductVersion | undefined,
    nodes: WorkspaceTreeNode[], logicalTree: WorkspaceTreeNode | null, visited: Set<string>, own: boolean,
  ): Promise<VersionChangeRow[]> {
    visited.add(`${repoKey(info.repoPath)}\u0000${v.id}`)
    const rows: VersionChangeRow[] = []
    for (const c of v.changes ?? []) {
      const el = await this.elementFile(info.repoPath, c.id)
      rows.push({
        component: info.name, componentLabel: info.label, repoPath: info.repoPath,
        versionId: v.id, versionTitle: v.title,
        category: el?.category ?? null, id: c.id, title: el?.state.title ?? '',
        ...(c.base && { base: c.base }),
        toSha: v.freeze?.sha ?? null,
        filePath: el?.filePath ?? null,
        own,
      })
    }
    for (const dep of this.dependencies(info.repoPath, logicalTree)) {
      let cur = v.components?.[dep.name]
      const stop = basedOnVersion?.components?.[dep.name]
      if (!cur || cur === stop) continue
      const depVersions = new Map((await this.list(dep.repoPath)).map(d => [d.id, d]))
      const depInfo = { name: dep.name, label: dep.label, repoPath: dep.repoPath }
      // Versions de la dépendance entre `stop` (exclue) et `cur` ; `stop` hors de la chaîne de `cur`
      // (retour arrière, autre lignée) : rien n'est attribué à cette version.
      const chain: ProductVersion[] = []
      const seen = new Set<string>()
      while (cur && cur !== stop && !seen.has(cur)) {
        seen.add(cur)
        const w = depVersions.get(cur)
        if (!w) break
        chain.push(w)
        cur = w.basedOn
      }
      if (stop && cur !== stop) continue
      for (const w of chain) {
        if (visited.has(`${repoKey(dep.repoPath)}\u0000${w.id}`)) continue
        const prev = w.basedOn ? depVersions.get(w.basedOn) : undefined
        rows.push(...await this.rowsOf(depInfo, w, prev, nodes, logicalTree, visited, false))
      }
    }
    return rows
  }

  /** Dépendances directes d'un repo dans l'arbre logique du workspace. */
  private dependencies(repoPath: string, logicalTree: WorkspaceTreeNode | null): RepoInfo[] {
    const find = (n: WorkspaceTreeNode): WorkspaceTreeNode | null =>
      repoKey(n.repoPath) === repoKey(repoPath) ? n : n.children.map(find).find(Boolean) ?? null
    const node = logicalTree ? find(logicalTree) : null
    return (node?.children ?? []).map(c => ({ name: c.name, label: c.label || c.name, repoPath: c.repoPath }))
  }

  private repoInfo(repoPath: string, nodes: WorkspaceTreeNode[]): RepoInfo {
    const node = nodes.find(n => repoKey(n.repoPath) === repoKey(repoPath))
    const name = node?.name ?? path.basename(repoPath)
    return { name, label: node?.label || name, repoPath }
  }

  // ── Analyse d'impact et tests à exécuter (GH245) ──────────────────────────

  /** Analyse d'une version : figée si released, calculée sur l'état courant du workspace sinon. */
  async analysis(repoPath: string, id: string, workspaceDir?: string): Promise<VersionAnalysis> {
    const version = await this.get(repoPath, id)
    const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
    if (versionState(typeDef, version.status) === 'released') {
      // Pas de reprise des versions released sans analyse figée : analyse vide, jamais recalculée.
      return version.analysis
        ? { ...version.analysis, frozen: true }
        : { computedAt: version.freeze?.at ?? '', frozen: true, roots: [], rows: [] }
    }
    return (await this.liveAnalysis(repoPath, version, workspaceDir)).analysis
  }

  /** Analyse calculée sur l'état courant du workspace, avec le snapshot lu (réutilisé par les tests). */
  private async liveAnalysis(
    repoPath: string, version: ProductVersion, workspaceDir?: string,
  ): Promise<{ analysis: VersionAnalysis; snapshot: ImpactSnapshot }> {
    const src = this.requireImpactSources()
    const page = await this.page(repoPath, version.id, workspaceDir)
    // Racines : les changements que liste la page (cette version et ses composants), une fois chacun.
    const roots = new Map<string, string>()
    for (const row of page.rows) if (row.category && !roots.has(row.id)) roots.set(row.id, row.component)
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const rootRepo = ws?.logicalTree.repoPath ?? repoPath
    const repoPaths = await resolveWorkspaceRepoPaths(this.workspaceTree, rootRepo, workspaceDir)
    const snapshot = await src.traceability.loadWorkingTreeSnapshot(rootRepo, repoPaths)
    return { snapshot, analysis: computeVersionAnalysis({
      roots: [...roots].map(([id, component]) => ({ id, component })),
      snapshot,
      trees: (id, type) => src.traceability.buildImpactTreesFromSnapshot(snapshot, id, type),
      repoPath,
      impacted: version.impacted ?? [],
    }) }
  }

  /** Statut d'impact et commentaire d'un élément (version en cours) ; statut par défaut sans commentaire : retiré. */
  async setImpact(
    repoPath: string, id: string, elementId: string, status: ImpactAnalysisStatus, comment?: string | null, workspaceDir?: string,
  ): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      if (!IMPACT_ANALYSIS_STATUSES.includes(status)) throw new VersionError('STATUS_UNKNOWN', String(status))
      const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
      const existing = await this.get(repoPath, id)
      if (versionState(typeDef, existing.status) !== 'in_progress') throw new VersionError('NOT_IN_PROGRESS', id)
      const text = comment?.trim()
      const others = (existing.impacted ?? []).filter(i => i.id !== elementId)
      const entry: VersionImpacted | null = status === 'impact_non_verifie' && !text ? null : { id: elementId, status, ...(text && { comment: text }) }
      const impacted = [...others, ...(entry ? [entry] : [])].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      const updated: ProductVersion = { ...existing }
      if (impacted.length > 0) updated.impacted = impacted
      else delete updated.impacted
      const filePath = `${VERSIONS_DIR}/${id}.yaml`
      const stamped = await this.stamp(repoPath, existing, updated, filePath)
      await this.git.writeYaml(repoPath, filePath, stamped)
      return stamped
    })
  }

  /** Analyse et tests à exécuter en un seul calcul (page d'une version : un snapshot lu une fois). */
  async impact(repoPath: string, id: string, workspaceDir?: string): Promise<{ analysis: VersionAnalysis; tests: VersionTestsToRun | null }> {
    const version = await this.get(repoPath, id)
    const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
    const state = versionState(typeDef, version.status)
    if (state === 'abandoned') throw new VersionError('VERSION_ABANDONED', id)
    if (state === 'released') return { analysis: await this.analysis(repoPath, id, workspaceDir), tests: await this.testsToRun(repoPath, id, workspaceDir) }
    const src = this.requireImpactSources()
    const [{ analysis, snapshot }, campaigns] = await Promise.all([
      this.liveAnalysis(repoPath, version, workspaceDir),
      src.campaigns.list(repoPath).catch(() => []),
    ])
    return { analysis, tests: computeVersionTests(analysis.roots.map(r => r.elementId), analysis.rows, snapshot, campaigns, repoPath) }
  }

  /** Tests à exécuter (GH245 §2) ; campagnes ouvertes du repo en information. Pas pour une version abandonnée. */
  async testsToRun(repoPath: string, id: string, workspaceDir?: string): Promise<VersionTestsToRun> {
    const src = this.requireImpactSources()
    const version = await this.get(repoPath, id)
    const typeDef = (await this.versionType(repoPath))?.typeDef ?? null
    const state = versionState(typeDef, version.status)
    if (state === 'abandoned') throw new VersionError('VERSION_ABANDONED', id)
    const campaigns = await src.campaigns.list(repoPath).catch(() => [])
    if (state === 'in_progress') {
      const { analysis, snapshot } = await this.liveAnalysis(repoPath, version, workspaceDir)
      return computeVersionTests(analysis.roots.map(r => r.elementId), analysis.rows, snapshot, campaigns, repoPath)
    }
    // Released : analyse figée ; couverture et campagnes lues sur l'état courant (on teste aujourd'hui).
    const analysis = await this.analysis(repoPath, id, workspaceDir)
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const rootRepo = ws?.logicalTree.repoPath ?? repoPath
    const snapshot = await src.traceability.loadWorkingTreeSnapshot(rootRepo, await resolveWorkspaceRepoPaths(this.workspaceTree, rootRepo, workspaceDir))
    return computeVersionTests(analysis.roots.map(r => r.elementId), analysis.rows, snapshot, campaigns, repoPath)
  }

  private requireImpactSources(): NonNullable<VersionsService['impactSources']> {
    if (!this.impactSources) throw new Error('Analyse d\'impact indisponible')
    return this.impactSources
  }

  // ── Passage released ───────────────────────────────────────────────────────

  /** Tag proposé et contrôles du passage released ; `tag` : contrôlé aussi (sinon le tag proposé). */
  async releasePreview(repoPath: string, id: string, workspaceDir?: string, tag?: string): Promise<VersionReleasePreview> {
    const version = await this.get(repoPath, id)
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const info = this.repoInfo(repoPath, ws?.nodes ?? [])
    const suggestedTag = suggestVersionTag(info.name, version.title)
    const problems = await this.releaseProblems(repoPath, version, workspaceDir)
    return { suggestedTag, problems: [...await this.tagProblems(repoPath, tag ?? suggestedTag), ...problems] }
  }

  private async tagProblems(repoPath: string, tag: string): Promise<VersionProblem[]> {
    const trimmed = tag.trim()
    if (!isValidTagName(trimmed)) return [{ code: 'TAG_INVALID', detail: trimmed }]
    if (await this.git.resolveTagOid(repoPath, trimmed)) return [{ code: 'TAG_EXISTS', detail: trimmed }]
    return []
  }

  private async releaseProblems(repoPath: string, version: ProductVersion, workspaceDir?: string): Promise<VersionProblem[]> {
    const problems: VersionProblem[] = []
    const vt = await this.versionType(repoPath)
    if (await this.isReadonly(repoPath, workspaceDir)) problems.push({ code: 'READONLY_REPO', detail: path.basename(repoPath) })
    if (versionState(vt?.typeDef ?? null, version.status) !== 'in_progress') problems.push({ code: 'NOT_IN_PROGRESS', detail: version.id })
    if (!vt?.typeDef.statuses?.some(s => s.isApproval)) problems.push({ code: 'NO_VERSION_TYPE', detail: 'aucun statut isApproval' })
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    // Dépendances de CE repo (même résolution que la page) : un nom de montage peut exister ailleurs.
    const deps = this.dependencies(repoPath, ws?.logicalTree ?? null)
    for (const [dep, depId] of Object.entries(version.components ?? {})) {
      const node = deps.find(d => d.name === dep)
      const depVt = node ? await this.versionType(node.repoPath) : null
      const depVersion = node ? await this.get(node.repoPath, depId).catch(() => null) : null
      if (!depVersion || versionState(depVt?.typeDef ?? null, depVersion.status) !== 'released') {
        problems.push({ code: 'COMPONENT_NOT_RELEASED', detail: `${dep} : ${depId}` })
      }
    }
    const head = await this.sync.resolveHead(repoPath)
    const dirty: string[] = []
    for (const c of version.changes ?? []) {
      const el = await this.elementFile(repoPath, c.id)
      if (!el) continue
      const atHead = head ? await this.tracking.readAt(repoPath, head, el.filePath) : null
      if (atHead?.key !== el.state.key) dirty.push(c.id)
    }
    if (dirty.length > 0) problems.push({ code: 'DIRTY_CHANGES', detail: dirty.join(', ') })
    return problems
  }

  /**
   * GH201 §3 — passage released : contrôles, `freeze = { tag, sha: HEAD }`, commit du seul fichier
   * de la version, tag annoté sur ce commit, push du tag au prochain push du repo.
   */
  async release(repoPath: string, id: string, tag: string, workspaceDir?: string): Promise<ProductVersion> {
    return this.enqueue(repoPath, async () => {
      const version = await this.get(repoPath, id)
      const trimmed = tag.trim()
      const problems = [...await this.tagProblems(repoPath, trimmed), ...await this.releaseProblems(repoPath, version, workspaceDir)]
      if (problems.length > 0) throw new VersionError(problems[0].code, problems.map(p => `${p.code} ${p.detail}`).join(' ; '))
      const vt = (await this.versionType(repoPath))!
      const approval = vt.typeDef.statuses!.find(s => s.isApproval)!.name
      const head = await this.sync.resolveHead(repoPath)
      if (!head) throw new VersionError('DIRTY_CHANGES', 'aucun commit dans le repo')
      const filePath = `${VERSIONS_DIR}/${id}.yaml`
      // GH245 — analyse figée dans le même commit : lignes et racines, sans les arbres (volumineux et
      // porteurs de chemins locaux), calculée sur l'état du workspace au moment du passage.
      const analysis = this.impactSources ? freezeAnalysis((await this.liveAnalysis(repoPath, version, workspaceDir)).analysis) : undefined
      const released = await this.stamp(repoPath, version, {
        ...version, status: approval, freeze: { tag: trimmed, sha: head, at: new Date().toISOString() }, ...(analysis && { analysis }),
      }, filePath)
      const content = yaml.dump(released, { lineWidth: 120 })
      // Tag posé sur le commit avant que la branche n'avance : un échec du tag laisse la version en cours.
      await this.sync.commitSingleFile(repoPath, filePath, content, `[version] ${id} ${version.title} released`,
        commit => this.sync.createAnnotatedTag(repoPath, trimmed, `${version.title} (${id})`, commit))
      await this.git.writeText(repoPath, filePath, content)
      await this.sync.queueTagPush(repoPath, trimmed).catch(err => console.warn(`[versions] tag ${trimmed} non mis en attente de push :`, err))
      return released
    })
  }

  // ── Contrôles ──────────────────────────────────────────────────────────────

  private assertLabel(typeDef: ObjectTypeDefinition | null, others: ProductVersion[], title: string): string {
    const label = (title ?? '').trim()
    if (!label) throw new VersionError('LABEL_EMPTY', '')
    const taken = others.find(v => v.title === label && versionState(typeDef, v.status) !== 'abandoned')
    if (taken) throw new VersionError('LABEL_TAKEN', `${label} (${taken.id})`)
    return label
  }

  private assertBasedOn(typeDef: ObjectTypeDefinition | null, versions: ProductVersion[], basedOn: string | null, self: string | null): string | null {
    if (!basedOn) return null
    const v = versions.find(x => x.id === basedOn)
    if (!v || v.id === self || versionState(typeDef, v.status) !== 'released') throw new VersionError('VERSION_NOT_FOUND', `${basedOn} (version released attendue)`)
    return basedOn
  }

  private async assertWritable(repoPath: string, workspaceDir?: string): Promise<void> {
    if (await this.isReadonly(repoPath, workspaceDir)) throw new VersionError('READONLY_REPO', path.basename(repoPath))
  }

  /** Composant épinglé (HEAD détaché) ou monté sous un nœud `readonly` du repo racine. */
  async isReadonly(repoPath: string, workspaceDir?: string): Promise<boolean> {
    if ((await this.git.currentBranch(repoPath).catch(() => '')) === 'HEAD') return true
    if (!workspaceDir || !this.schemaReadonlyRepos) return false
    const ws = await this.workspaceTree?.readCache(workspaceDir)
    if (!ws) return false
    return [...await this.schemaReadonlyRepos(ws.logicalTree.repoPath, workspaceDir)].some(r => repoKey(r) === repoKey(repoPath))
  }

  private async readonlyKeys(rootRepoPath: string, workspaceDir?: string): Promise<Set<string>> {
    const ws = workspaceDir ? await this.workspaceTree?.readCache(workspaceDir) : null
    const repos = ws ? ws.nodes.map(n => n.repoPath) : [rootRepoPath]
    // Repos sous un nœud `readonly` : calculés une fois pour tout le workspace.
    const out = new Set<string>(ws && this.schemaReadonlyRepos
      ? [...await this.schemaReadonlyRepos(ws.logicalTree.repoPath, workspaceDir!)].map(repoKey) : [])
    await Promise.all(repos.map(async r => {
      if ((await this.git.currentBranch(r).catch(() => '')) === 'HEAD') out.add(repoKey(r))
    }))
    return out
  }

  private async stamp(repoPath: string, before: ProductVersion | null, after: ProductVersion, filePath: string): Promise<ProductVersion> {
    return this.history ? this.history.stamp(repoPath, after.objectTypeRef, before, after, { filePath }) : after
  }
}

/** Analyse à écrire dans le fichier : sans arbres, sans clé `undefined` (YAML). */
function freezeAnalysis(a: VersionAnalysis): VersionAnalysis {
  return JSON.parse(JSON.stringify({
    ...a, frozen: true,
    roots: a.roots.map(r => ({ ...r, descendantTree: [], ascendantTree: [] })),
  })) as VersionAnalysis
}

/** Versions released par ordre de livraison (`freeze.at`). */
function releasedInOrder(typeDef: ObjectTypeDefinition | null, versions: ProductVersion[]): ProductVersion[] {
  return versions
    .filter(v => v.freeze && versionState(typeDef, v.status) === 'released')
    .sort((a, b) => a.freeze!.at.localeCompare(b.freeze!.at))
}

function cleanComponents(components: Record<string, string> | undefined): Record<string, string> | undefined {
  const entries = Object.entries(components ?? {}).filter(([, v]) => !!v)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** Un formulaire qui renvoie le contenu inchangé d'une version released passe le verrou. */
function sameContent(v: ProductVersion, dto: UpdateVersionDto): boolean {
  const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (dto.title === undefined || dto.title === v.title)
    && (dto.basedOn === undefined || eq(dto.basedOn || null, v.basedOn || null))
    && (dto.components === undefined || eq(cleanComponents(dto.components), cleanComponents(v.components)))
    && (dto.fields === undefined || eq({ ...v.fields, ...dto.fields }, v.fields))
}

function isTerminal(schema: ProjectSchema | null, el: ElementState): boolean {
  const typeDef = schema ? findObjectTypeDef(schema, el.objectTypeRef) : null
  return !!(typeDef && typeDef !== 'unresolvable' && typeDef.statuses?.find(s => s.name === el.status)?.isTerminal)
}
