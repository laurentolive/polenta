import * as yaml from 'js-yaml'
import type { ProjectSchema } from '@polenta/types'
import type { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import { findObjectTypeDef } from './schema-lookup.util'

/** Élément lu sur disque ou à un commit, tel que le backlog des versions le compare (GH201 §4). */
export interface ElementState {
  id: string
  objectTypeRef: string
  status: string
  version: number
  title: string
  /** Contenu hors champs posés par l'application (`history`, `needsRevalidation`…). */
  key: string
  /** Contenu GH200 §2 (sans statut ni `version`) : détection des modifications hors interface. */
  contentKey: string
}

/** GH200 §5 — approuvé dont le contenu a changé sans réouverture (git direct, autre outil). */
export interface OutsideModification {
  id: string
  category: 'requirement' | 'test'
  /** Commit où l'élément est entré dans son statut approuvé (null : jamais commité). */
  approvedSha: string | null
  /** Différence pas encore commitée. */
  dirty: boolean
  filePath: string
}

export const ELEMENT_DIRS = [['requirements', 'requirement'], ['tests', 'test'], ['issues', 'issue']] as const

/** Nombre d'états d'éléments gardés en mémoire (par repo, commit et fichier). */
const CONTENT_CACHE_MAX = 20_000

/**
 * GH201 — lecture d'éléments (exigences, tests) à un commit ou sur disque, et détection des
 * modifications hors interface (reprise de `ChangeTrackingService` @ 4e06052, sans changeset).
 * Caches mémoire : contenu par (repo, commit, fichier), historique des fichiers par HEAD.
 */
export class VersionTrackingService {
  constructor(
    private readonly git: GitService,
    private readonly schema: Pick<SchemaService, 'get'>,
  ) {}

  private readonly historyCache = new Map<string, { head: string; commits: Map<string, string[]> }>()
  private readonly contentCache = new Map<string, ElementState | null>()

  async readDisk(repo: string, filePath: string): Promise<ElementState | null> {
    return elementState(await this.git.readYaml<ElementRecord>(repo, filePath).catch(() => null))
  }

  async readAt(repo: string, oid: string, filePath: string): Promise<ElementState | null> {
    const key = `${repo}\u0000${oid}\u0000${filePath}`
    if (!this.contentCache.has(key)) {
      const text = await this.git.readTextAt(repo, oid, filePath).catch(() => null)
      let parsed: ElementRecord | null = null
      try {
        parsed = text ? yaml.load(text) as ElementRecord : null
      } catch {
        parsed = null
      }
      // Borné : vidé d'un coup au-delà du seuil (les lectures suivantes le reconstruisent).
      if (this.contentCache.size >= CONTENT_CACHE_MAX) this.contentCache.clear()
      this.contentCache.set(key, elementState(parsed))
    }
    return this.contentCache.get(key)!
  }

  /**
   * GH200 §5 — éléments au statut `isApproval` dont le contenu (sur disque) diffère de l'état
   * où ils sont entrés dans ce statut : modifiés sans réouverture, donc hors de l'application.
   */
  async outsideModifications(repo: string): Promise<OutsideModification[]> {
    const [schema, head] = await Promise.all([this.schema.get(repo).catch(() => null), this.git.headSha(repo).catch(() => '')])
    if (!head) return []
    const out: OutsideModification[] = []
    for (const [dir, category] of ELEMENT_DIRS) {
      if (category === 'issue') continue // pas de verrou d'approbation sur une issue (GH244)
      const files = (await this.git.listFiles(repo, dir).catch(() => [])).filter(f => f.endsWith('.yaml'))
      for (const filePath of files) {
        const disk = await this.readDisk(repo, filePath)
        if (!disk || !isApproved(schema, disk)) continue
        const entry = await this.approvalEntry(repo, filePath, schema, await this.commitsOf(repo, filePath))
        if (!entry) continue
        const approvedAt = await this.readAt(repo, entry, filePath)
        if (!approvedAt || approvedAt.contentKey === disk.contentKey) continue
        const atHead = await this.readAt(repo, head, filePath)
        out.push({ id: disk.id, category, approvedSha: entry, dirty: atHead?.contentKey !== disk.contentKey, filePath })
      }
    }
    return out
  }

  /**
   * Commit où l'élément est entré pour la dernière fois dans un statut `isApproval`, parmi `commits`
   * (du plus récent au plus ancien) ; `null` : pas approuvé au plus récent.
   */
  private async approvalEntry(repo: string, filePath: string, schema: ProjectSchema | null, commits: string[]): Promise<string | null> {
    let entry: string | null = null
    for (const oid of commits) {
      const snap = await this.readAt(repo, oid, filePath)
      if (!snap || !isApproved(schema, snap)) return entry
      entry = oid
    }
    return entry
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
}

interface ElementRecord {
  id?: string
  objectTypeRef?: string
  status?: string
  version?: number
  title?: string
  [key: string]: unknown
}

/** Champs posés par l'application, qui ne sont pas un changement de l'élément (GH201 §4). */
const APP_KEYS = new Set(['history', 'needsRevalidation', 'projectId', 'branchId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'])
/** GH200 §2 — champs de contenu comparés pour le hors interface (pas statut ni `version`). */
const CONTENT_KEYS = ['title', 'fields', 'steps', 'preconditions', 'postconditions', 'equipment']

export function elementState(o: ElementRecord | null): ElementState | null {
  if (!o?.id) return null
  const all = Object.fromEntries(Object.entries(o).filter(([k]) => !APP_KEYS.has(k)))
  const content = Object.fromEntries(CONTENT_KEYS.map(k => [k, o[k] ?? null]))
  return {
    id: o.id, objectTypeRef: o.objectTypeRef ?? '', status: o.status ?? '', version: o.version ?? 1, title: o.title ?? '',
    key: stableJson(all), contentKey: stableJson(content),
  }
}

/** JSON à clés triées : deux écritures YAML du même contenu donnent la même clé. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v instanceof Date) return JSON.stringify(v)
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function isApproved(schema: ProjectSchema | null, el: ElementState): boolean {
  const typeDef = schema ? findObjectTypeDef(schema, el.objectTypeRef) : null
  return !!(typeDef && typeDef !== 'unresolvable' && typeDef.statuses?.find(s => s.name === el.status)?.isApproval)
}
