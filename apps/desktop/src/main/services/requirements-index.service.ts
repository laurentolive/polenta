import MiniSearch from 'minisearch'
import type { Requirement, ObjectLink } from '@polenta/types'
import type { GitService } from './git.service'
import { withKeyLock } from './serialize-writes.util'

const LINKS_FILE = 'links/links.yaml'

function newLinkId(): string {
  return `lnk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function linksLockKey(repoPath: string): string {
  return `links::${repoPath}`
}

interface RequirementVersion {
  versionNumber: number
  [key: string]: unknown
}

export interface RequirementFilters {
  type?: string
  status?: string
  tags?: string[]
  search?: string
  needsRevalidation?: boolean
}

interface RepoIndex {
  requirements: Map<string, Requirement>
  links: ObjectLink[]
  versions: Map<string, RequirementVersion[]>
  search: MiniSearch
  loadedAt: Date
}

export class RequirementsIndexService {
  private readonly index = new Map<string, RepoIndex>()

  constructor(private readonly git: GitService) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  async findAll(repoPath: string, filters: RequirementFilters = {}): Promise<Requirement[]> {
    const idx = await this.getOrBuild(repoPath)
    let results = Array.from(idx.requirements.values())

    if (filters.type) results = results.filter((r) => r.objectTypeRef === filters.type)
    if (filters.status) results = results.filter((r) => r.status === filters.status)
    if (filters.needsRevalidation !== undefined) {
      results = results.filter((r) => !!r.needsRevalidation === filters.needsRevalidation)
    }
    if (filters.tags?.length) {
      results = results.filter((r) => {
        const reqTags = (r.fields as Record<string, unknown>)['tags'] as string[] | undefined
        return filters.tags!.every((t) => reqTags?.includes(t))
      })
    }

    if (filters.search) {
      const hits = idx.search.search(filters.search, { fuzzy: 0.2, prefix: true })
      const hitIds = new Set(hits.map((h: { id: string }) => h.id))
      results = results.filter((r) => hitIds.has(r.id))
    }

    return results.sort((a, b) => a.id.localeCompare(b.id))
  }

  async findById(repoPath: string, id: string): Promise<Requirement | null> {
    const idx = await this.getOrBuild(repoPath)
    return idx.requirements.get(id) ?? null
  }

  async findLinks(repoPath: string, requirementId: string): Promise<ObjectLink[]> {
    const idx = await this.getOrBuild(repoPath)
    return idx.links.filter((l) => l.sourceId === requirementId || l.targetId === requirementId)
  }

  async findVersions(repoPath: string, requirementId: string): Promise<RequirementVersion[]> {
    const idx = await this.getOrBuild(repoPath)
    return (idx.versions.get(requirementId) ?? []).sort((a, b) => b.versionNumber - a.versionNumber)
  }

  async findAllLinks(repoPath: string): Promise<ObjectLink[]> {
    const idx = await this.getOrBuild(repoPath)
    return idx.links
  }

  async createLink(repoPath: string, data: { type: string; sourceId: string; targetId: string }): Promise<ObjectLink> {
    const idx = await this.getOrBuild(repoPath)
    const newLink: ObjectLink = {
      id: newLinkId(),
      type: data.type,
      sourceId: data.sourceId,
      targetId: data.targetId,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
    } as unknown as ObjectLink
    idx.links.push(newLink)
    await this.git.writeYaml(repoPath, 'links/links.yaml', { links: idx.links })
    return newLink
  }

  async deleteLink(repoPath: string, linkId: string): Promise<void> {
    const idx = await this.getOrBuild(repoPath)
    idx.links = idx.links.filter((l) => l.id !== linkId)
    await this.git.writeYaml(repoPath, 'links/links.yaml', { links: idx.links })
  }

  /**
   * GH16 — relit `links/links.yaml` depuis le disque (le process MCP n'a pas de
   * `RepoWatcherService` : son cache peut ignorer un lien créé entre-temps par l'app) et
   * remplace le cache s'il est construit. Lève si le fichier a un contenu dont `links`
   * n'est pas un tableau : l'appelant réécrirait sinon le fichier à partir de `[]`.
   */
  async reloadLinks(repoPath: string): Promise<ObjectLink[]> {
    const data = await this.git.readYaml<{ links?: unknown } | null>(repoPath, LINKS_FILE)
    let links: ObjectLink[] = []
    if (data != null) {
      if (!Array.isArray(data.links)) {
        throw new Error(`${LINKS_FILE} : champ "links" absent ou pas un tableau — fichier non modifié`)
      }
      links = data.links as ObjectLink[]
    }
    const idx = this.index.get(repoPath)
    if (idx) idx.links = links
    return links
  }

  /**
   * GH16 — ajoute un lot de liens (déjà validés) en une seule écriture, à partir de l'état
   * disque courant. Le contrôle de doublon (même type, même paire, quel que soit le sens)
   * est refait ici, sous le verrou, contre le fichier relu : la validation de l'appelant a
   * lu un état antérieur (appel concurrent, lien ajouté par l'app entre-temps). Retour
   * aligné sur `data` : `null` = entrée écartée car devenue un doublon.
   */
  createLinks(
    repoPath: string,
    data: Array<{ type: string; sourceId: string; targetId: string }>,
    createdBy: string,
  ): Promise<Array<ObjectLink | null>> {
    return withKeyLock(linksLockKey(repoPath), async () => {
      if (data.length === 0) return []
      const links = await this.reloadLinks(repoPath)
      const pairKey = (type: string, a: string, b: string): string => (a < b ? `${type}|${a}|${b}` : `${type}|${b}|${a}`)
      const pairs = new Set(links.map((l) => pairKey(l.type, l.sourceId, l.targetId)))
      const usedIds = new Set(links.map((l) => l.id))
      const createdAt = new Date().toISOString()
      const result = data.map((d): ObjectLink | null => {
        const key = pairKey(d.type, d.sourceId, d.targetId)
        if (pairs.has(key)) return null
        pairs.add(key)
        let id = newLinkId()
        while (usedIds.has(id)) id = newLinkId()
        usedIds.add(id)
        return { id, type: d.type, sourceId: d.sourceId, targetId: d.targetId, createdAt, createdBy } as ObjectLink
      })
      const created = result.filter((l): l is ObjectLink => l !== null)
      if (created.length === 0) return result
      const next = [...links, ...created]
      await this.git.writeYaml(repoPath, LINKS_FILE, { links: next })
      const idx = this.index.get(repoPath)
      if (idx) idx.links = next
      return result
    })
  }

  /** GH16 — supprime les liens d'ids donnés en une seule écriture ; retourne les ids réellement supprimés. */
  deleteLinks(repoPath: string, ids: string[]): Promise<string[]> {
    return withKeyLock(linksLockKey(repoPath), async () => {
      const links = await this.reloadLinks(repoPath)
      const wanted = new Set(ids)
      const deleted = links.filter((l) => wanted.has(l.id)).map((l) => l.id)
      if (deleted.length === 0) return []
      const next = links.filter((l) => !wanted.has(l.id))
      await this.git.writeYaml(repoPath, LINKS_FILE, { links: next })
      const idx = this.index.get(repoPath)
      if (idx) idx.links = next
      return deleted
    })
  }

  upsert(repoPath: string, req: Requirement): void {
    const idx = this.index.get(repoPath)
    if (!idx) return // Will be built on next access

    idx.requirements.set(req.id, req)

    // Sync MiniSearch
    if (idx.search.has(req.id)) {
      idx.search.replace(req)
    } else {
      idx.search.add(req)
    }
  }

  upsertVersion(repoPath: string, reqId: string, version: RequirementVersion): void {
    const idx = this.index.get(repoPath)
    if (!idx) return

    const versions = idx.versions.get(reqId) ?? []
    const existing = versions.findIndex((v) => v.versionNumber === version.versionNumber)
    if (existing >= 0) versions[existing] = version
    else versions.push(version)
    idx.versions.set(reqId, versions)
  }

  upsertLink(repoPath: string, link: ObjectLink): void {
    const idx = this.index.get(repoPath)
    if (!idx) return

    const existing = idx.links.findIndex((l) => l.id === link.id)
    if (existing >= 0) idx.links[existing] = link
    else idx.links.push(link)
  }

  invalidate(repoPath: string): void {
    this.index.delete(repoPath)
    console.log(`[RequirementsIndex] Index invalidated: ${repoPath}`)
  }

  invalidateFile(repoPath: string, filePath: string): void {
    if (
      filePath.startsWith('requirements/') ||
      filePath.startsWith('versions/') ||
      filePath.startsWith('links/')
    ) {
      this.invalidate(repoPath)
    }
  }

  // ─── Build ───────────────────────────────────────────────────────────────────

  private async getOrBuild(repoPath: string): Promise<RepoIndex> {
    if (!this.index.has(repoPath)) {
      await this.build(repoPath)
    }
    return this.index.get(repoPath)!
  }

  async build(repoPath: string): Promise<void> {
    console.log(`[RequirementsIndex] Building index for ${repoPath}`)
    const start = Date.now()

    const requirements = new Map<string, Requirement>()
    const versions = new Map<string, RequirementVersion[]>()

    const reqFiles = await this.git.listFiles(repoPath, 'requirements')
    const versionFiles = await this.git.listFiles(repoPath, 'versions')
    const linksFiles = await this.git.listFiles(repoPath, 'links')

    // Load requirements — createdAt/createdBy/updatedAt/updatedBy are derived from the
    // file's git log (T112), never trusted from the YAML itself: overwritten
    // unconditionally below, whatever stale/absent keys the file may still have.
    // T142 — one batched history walk for every file under `requirements/`, instead of one
    // `git.fileHistory()` (full history re-walk) per file: see GitService.fileHistoryMap().
    const historyMap = await this.git.fileHistoryMap(repoPath, 'requirements')
    await Promise.all(
      reqFiles
        .filter((f) => f.endsWith('.yaml'))
        .map(async (file) => {
          const req = await this.git.readYaml<Requirement>(repoPath, file)
          if (!req?.id) return
          const history = historyMap.get(file)
          requirements.set(req.id, {
            ...req,
            createdAt: history?.createdAt ?? null,
            createdBy: history?.createdBy ?? null,
            updatedAt: history?.updatedAt ?? null,
            updatedBy: history?.updatedBy ?? null,
          })
        }),
    )

    // Load version snapshots
    await Promise.all(
      versionFiles
        .filter((f) => f.endsWith('.yaml'))
        .map(async (file) => {
          const version = await this.git.readYaml<RequirementVersion>(repoPath, file)
          if (!version) return
          // Infer reqId from path: versions/SW-0042/v1.yaml → SW-0042
          const match = file.match(/^versions\/(.+)\/v\d+\.yaml$/)
          if (!match) return
          const reqId = match[1]
          const list = versions.get(reqId) ?? []
          list.push(version)
          versions.set(reqId, list)
        }),
    )

    // Load links — single file or multiple
    let allLinks: ObjectLink[] = []
    const linksYaml = linksFiles.find((f) => f === 'links/links.yaml')
    if (linksYaml) {
      const linksData = await this.git.readYaml<{ links: ObjectLink[] }>(repoPath, linksYaml)
      allLinks = linksData?.links ?? []
    }

    // Build MiniSearch
    const search = new MiniSearch<Requirement>({
      idField: 'id',
      fields: ['title', 'statement', 'rationale'],
      storeFields: ['id', 'type', 'status', 'title'],
      extractField: (doc: unknown, field: string) => {
        const r = doc as Requirement & { statement?: string; rationale?: string }
        if (field === 'statement') return String((r.fields as Record<string, unknown>)?.['statement'] ?? '')
        if (field === 'rationale') return String((r.fields as Record<string, unknown>)?.['rationale'] ?? '')
        return String((r as unknown as Record<string, unknown>)[field] ?? '')
      },
    })
    search.addAll(Array.from(requirements.values()))

    this.index.set(repoPath, {
      requirements,
      links: allLinks,
      versions,
      search,
      loadedAt: new Date(),
    })

    console.log(`[RequirementsIndex] Built for ${repoPath} — ${requirements.size} requirements in ${Date.now() - start}ms`)
  }

}

