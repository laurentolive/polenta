import * as yaml from 'js-yaml'
import type {
  Change, ChangeElementRef, ChangeToModifyTrace, ModificationCheck, ModificationKind, OutsideModification, ProjectSchema,
} from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'
import type { ChangesService } from './changes.service'
import type { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { statusModificationKind } from './approved-lock.util'
import { findObjectTypeDef } from './schema-lookup.util'

/** Élément qui devient modifiable, tel que vu par les services d'écriture. */
export interface TrackedElement {
  id: string
  /** Chemin du fichier de l'élément dans son repo (`requirements/<ID>.yaml`). */
  filePath: string
  /** `version` de l'élément avant la réouverture (absent : création). */
  versionBefore?: number
}

/**
 * GH200 — crochet appelé par `RequirementsService` / `TestsService` (injection optionnelle, comme
 * la revalidation T172 : pas de dépendance circulaire avec `ChangesService`).
 */
export interface ModificationTracker {
  /** Changeset demandé : ouvert dans le repo de l'élément, sinon erreur — avant toute écriture. */
  assertChangeset(repo: string, changesetId: string): Promise<void>
  /** Assigne l'élément après son écriture ; renvoie l'ID du changeset, `null` si non assigné. */
  onModified(repo: string, el: TrackedElement, kind: ModificationKind, changesetId?: string): Promise<string | null>
}

/**
 * GH200 — rattachement par élément (specs/GH200.md) : toute création, réouverture ou passage
 * terminal depuis l'approuvé d'une exigence ou d'un test l'ajoute à `toModify` d'un changeset
 * ouvert de son repo — celui demandé, sinon le seul ouvert ; plusieurs sans choix : non assigné
 * (backlog). Un élément déjà dans un changeset non clos y reste (P4). Règle par repo :
 * `preferences.changeTracking`, défaut `on` si le repo déclare un type de changeset.
 */
export class ChangeTrackingService implements ModificationTracker {
  constructor(
    private readonly git: GitService,
    private readonly schema: Pick<SchemaService, 'get' | 'resolveComponentRepoPath'>,
    private readonly changes: Pick<ChangesService, 'repoSummaries' | 'attach' | 'componentOf'>,
  ) {}

  async isOn(repo: string): Promise<boolean> {
    return trackingOn(await this.schema.get(repo).catch(() => null))
  }

  /**
   * Contrôle avant une création / réouverture, pour la porte du renderer. Changement de statut
   * (`toStatus`, avec `id` et `category`) : le statut courant est lu sur disque ; une transition qui
   * ne quitte pas l'approbation n'est pas une réouverture (`tracking: false`, rien à demander).
   */
  async check(
    repoPath: string,
    el: { id?: string; objectTypeRef: string; category?: 'requirement' | 'test'; toStatus?: string },
    _kind: ModificationKind, workspaceDir?: string,
  ): Promise<ModificationCheck> {
    const repo = (await this.schema.resolveComponentRepoPath(repoPath, el.objectTypeRef, workspaceDir)) ?? repoPath
    const [tracking, summaries, component, reopening] = await Promise.all([
      this.isOn(repo),
      this.changes.repoSummaries(repo),
      this.changes.componentOf(repo, el.objectTypeRef),
      el.toStatus && el.id && el.category ? this.leavesApproval(repoPath, repo, el as Required<typeof el>) : Promise.resolve(true),
    ])
    const eligible = summaries.filter(s => s.open)
    const assignedTo = el.id ? eligible.find(s => s.toModifyIds.includes(el.id!))?.id ?? null : null
    return { tracking: tracking && reopening, assignedTo, eligible, component, repoPath: repo }
  }

  /** Le passage de l'élément (fichier sur disque) à `toStatus` quitte-t-il un statut `isApproval` ? */
  private async leavesApproval(
    repoPath: string, repo: string, el: { id: string; objectTypeRef: string; category: 'requirement' | 'test'; toStatus: string },
  ): Promise<boolean> {
    const dir = el.category === 'requirement' ? 'requirements' : 'tests'
    const [schema, current] = await Promise.all([
      this.schema.get(repoPath).catch(() => null),
      this.git.readYaml<{ status?: string }>(repo, `${dir}/${el.id}.yaml`).catch(() => null),
    ])
    const typeDef = schema ? findObjectTypeDef(schema, el.objectTypeRef, el.category) : null
    const resolved = typeDef && typeDef !== 'unresolvable' ? typeDef : null
    return !!current?.status && statusModificationKind(resolved, current.status, el.toStatus) !== null
  }

  async assertChangeset(repo: string, changesetId: string): Promise<void> {
    const summary = (await this.changes.repoSummaries(repo)).find(s => s.id === changesetId)
    if (!summary) throw new Error(`Changeset introuvable dans le repo de l'élément : ${changesetId}`)
    if (!summary.open) throw new Error(`${changesetId} est clos : il ne reçoit plus d'éléments`)
  }

  async onModified(repo: string, el: TrackedElement, kind: ModificationKind, changesetId?: string): Promise<string | null> {
    if (!(await this.isOn(repo))) return null
    const open = (await this.changes.repoSummaries(repo)).filter(s => s.open)
    const base = kind === 'create' ? undefined : await this.baseOf(repo, el)
    const holder = open.find(s => s.toModifyIds.includes(el.id))
    const target = holder?.id
      ?? (changesetId && open.some(s => s.id === changesetId) ? changesetId : undefined)
      ?? (!changesetId && open.length === 1 ? open[0].id : undefined)
    if (!target) return null
    // Déjà présent (P4) : `attach` ne fait que compléter `base` si elle manque.
    if (!holder || base) await this.changes.attach(repo, target, [{ id: el.id, ...(base && { base }) }])
    return target
  }

  /** Version de départ : dernier commit qui touche le fichier (état approuvé publié). */
  private async baseOf(repo: string, el: TrackedElement): Promise<ChangeElementRef> {
    const [last] = await this.git.fileCommits(repo, el.filePath).catch(() => [])
    return { sha: last?.oid ?? null, version: el.versionBefore ?? 1 }
  }

  // ─── Trace départ / approbation (§4) et modifications hors interface (§5) ─────

  /** Commits (premiers parents de HEAD) par fichier d'élément, du plus récent au plus ancien ; par HEAD. */
  private readonly historyCache = new Map<string, { head: string; commits: Map<string, string[]> }>()
  /** Contenu normalisé d'un fichier dans un commit (immuable). */
  private readonly contentCache = new Map<string, ElementSnapshot | null>()

  /**
   * GH200 §4 — trace de chaque ligne de `toModify` : départ, commit d'approbation (figé dans le
   * fichier au statut terminal, calculé sinon), état `modified`.
   */
  async trace(repo: string, change: Change): Promise<ChangeToModifyTrace[]> {
    const [schema, head] = await Promise.all([this.schema.get(repo).catch(() => null), this.git.headSha(repo).catch(() => '')])
    const changeType = schema ? findObjectTypeDef(schema, change.objectTypeRef, 'changeset') : null
    // Changeset terminal : trace figée dans le fichier (§4), rien n'est recalculé.
    const frozen = !!(changeType && changeType !== 'unresolvable' && changeType.statuses?.find(s => s.name === change.status)?.isTerminal)
    return Promise.all(change.toModify.map(async (entry): Promise<ChangeToModifyTrace> => {
      const base = entry.base ?? null
      const filePath = await this.elementPath(repo, entry.id)
      const empty = { id: entry.id, state: entry.state, base, created: !base, filePath }
      if (!filePath || frozen) return { ...empty, approved: entry.approved ?? null, approvalPending: !entry.approved }
      const [disk, atHead, commits] = await Promise.all([
        this.readDisk(repo, filePath), head ? this.readAt(repo, head, filePath) : Promise.resolve(null), this.commitsOf(repo, filePath),
      ])
      const after = commitsAfter(commits, base?.sha ?? null)
      const dirty = !!disk && disk.key !== atHead?.key
      const state = entry.state === 'modified' || after.length > 0 || dirty ? 'modified' : 'planned'
      const approved = entry.approved
        ?? (disk && !dirty && isApproved(schema, disk) ? await this.approvalEntry(repo, filePath, schema, after, base) : null)
      return { ...empty, state, approved, approvalPending: !approved }
    }))
  }

  /**
   * GH200 §5 — éléments au statut `isApproval` dont le contenu (sur disque) diffère de l'état
   * où ils sont entrés dans ce statut : modifiés sans réouverture, donc hors de l'application.
   */
  async outsideModifications(repo: string): Promise<OutsideModification[]> {
    if (!(await this.isOn(repo))) return []
    const [schema, head] = await Promise.all([this.schema.get(repo).catch(() => null), this.git.headSha(repo).catch(() => '')])
    if (!head) return []
    const out: OutsideModification[] = []
    for (const [dir, category] of [['requirements', 'requirement'], ['tests', 'test']] as const) {
      const files = (await this.git.listFiles(repo, dir).catch(() => [])).filter(f => f.endsWith('.yaml'))
      for (const filePath of files) {
        const disk = await this.readDisk(repo, filePath)
        if (!disk || !isApproved(schema, disk)) continue
        const commits = await this.commitsOf(repo, filePath)
        const entry = await this.approvalEntry(repo, filePath, schema, commits, null)
        if (!entry?.sha) continue
        const approvedAt = await this.readAt(repo, entry.sha, filePath)
        if (!approvedAt || approvedAt.key === disk.key) continue
        const atHead = await this.readAt(repo, head, filePath)
        out.push({ id: disk.id, category, approvedSha: entry.sha, dirty: atHead?.key !== disk.key, filePath })
      }
    }
    return out
  }

  /**
   * Commit où l'élément est entré pour la dernière fois dans un statut `isApproval`, parmi `commits`
   * (du plus récent au plus ancien). `base` : état approuvé avant le plus ancien. Sans passage par un
   * statut non approuvé dans `commits` (réouverture et réapprobation publiées dans un même commit), une
   * version plus récente que celle de la base reste une nouvelle approbation.
   * `null` : pas approuvé à HEAD, ou approuvé sans réouverture depuis la base.
   */
  private async approvalEntry(
    repo: string, filePath: string, schema: ProjectSchema | null, commits: string[], base: ChangeElementRef | null,
  ): Promise<ChangeElementRef | null> {
    let entry: ChangeElementRef | null = null
    for (const oid of commits) {
      const snap = await this.readAt(repo, oid, filePath)
      if (!snap || !isApproved(schema, snap)) return entry
      entry = { sha: oid, version: snap.version }
    }
    return !base || (entry && entry.version !== base.version) ? entry : null
  }

  private async commitsOf(repo: string, filePath: string): Promise<string[]> {
    const head = await this.git.headSha(repo).catch(() => '')
    let cached = this.historyCache.get(repo)
    if (!cached || cached.head !== head) {
      const commits = new Map<string, string[]>()
      // `commitChanges` : du plus ancien au plus récent ; chaque liste devient du plus récent au plus ancien.
      for (const c of head ? await this.git.commitChanges(repo, ['requirements', 'tests']).catch(() => []) : []) {
        for (const f of c.files) commits.set(f, [c.oid, ...(commits.get(f) ?? [])])
      }
      cached = { head, commits }
      this.historyCache.set(repo, cached)
    }
    return cached.commits.get(filePath) ?? []
  }

  /** Fichier de l'élément : exigence ou test, sur disque ou seulement dans l'historique. */
  private async elementPath(repo: string, id: string): Promise<string | null> {
    for (const dir of ['requirements', 'tests']) {
      const rel = `${dir}/${id}.yaml`
      if (await this.git.fileExists(repo, rel) || (await this.commitsOf(repo, rel)).length > 0) return rel
    }
    return null
  }

  private async readDisk(repo: string, filePath: string): Promise<ElementSnapshot | null> {
    return snapshot(await this.git.readYaml<ElementRecord>(repo, filePath).catch(() => null))
  }

  private async readAt(repo: string, oid: string, filePath: string): Promise<ElementSnapshot | null> {
    const key = `${repo}\u0000${oid}\u0000${filePath}`
    if (!this.contentCache.has(key)) {
      const text = await this.git.readTextAt(repo, oid, filePath).catch(() => null)
      let parsed: ElementRecord | null = null
      try {
        parsed = text ? yaml.load(text) as ElementRecord : null
      } catch {
        parsed = null
      }
      this.contentCache.set(key, snapshot(parsed))
    }
    return this.contentCache.get(key)!
  }
}

interface ElementRecord {
  id?: string
  objectTypeRef?: string
  status?: string
  version?: number
  [key: string]: unknown
}

/** Élément lu (disque ou commit) : statut, version, et clé de son contenu (§2). */
interface ElementSnapshot {
  id: string
  objectTypeRef: string
  status: string
  version: number
  key: string
}

/** GH200 §2 — champs de contenu comparés (pas `history`, `needsRevalidation`, `version`, statut). */
const CONTENT_KEYS = ['title', 'fields', 'steps', 'preconditions', 'postconditions', 'equipment']

function snapshot(o: ElementRecord | null): ElementSnapshot | null {
  if (!o?.id) return null
  const content = Object.fromEntries(CONTENT_KEYS.map(k => [k, o[k] ?? null]))
  return { id: o.id, objectTypeRef: o.objectTypeRef ?? '', status: o.status ?? '', version: o.version ?? 1, key: stableJson(content) }
}

/** JSON à clés triées : deux écritures YAML du même contenu donnent la même clé. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function isApproved(schema: ProjectSchema | null, el: ElementSnapshot): boolean {
  const typeDef = schema ? findObjectTypeDef(schema, el.objectTypeRef) : null
  return !!(typeDef && typeDef !== 'unresolvable' && typeDef.statuses?.find(s => s.name === el.status)?.isApproval)
}

/** Commits postérieurs à `base` (exclue) ; base absente de l'historique ou nulle : tous. */
function commitsAfter(commits: string[], base: string | null): string[] {
  const i = base ? commits.indexOf(base) : -1
  return i >= 0 ? commits.slice(0, i) : commits
}

/** Règle active : préférence explicite, sinon présence d'un type de catégorie changeset. */
export function trackingOn(schema: ProjectSchema | null): boolean {
  if (!schema) return false
  const hasType = flattenSystemNodes(schema.nodes ?? [])
    .some(({ node }) => (node.objectTypes ?? []).some(t => t.category === 'changeset'))
  if (!hasType) return false
  return schema.preferences?.changeTracking !== 'off'
}
