import { Injectable, Logger } from '@nestjs/common'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MiniSearch = require('minisearch') as typeof import('minisearch').default
import type { Requirement, ObjectLink } from '@polenta/types'
import { GitService } from '../git/git.service'

interface BranchIndex {
  requirements: Map<string, Requirement>
  links: ObjectLink[]
  search: InstanceType<typeof MiniSearch>
  loadedAt: Date
}

export interface RequirementFilters {
  objectTypeRef?: string
  status?: string
  tags?: string[]
  search?: string
  needsRevalidation?: boolean
}

@Injectable()
export class RequirementsIndexService {
  private readonly logger = new Logger(RequirementsIndexService.name)
  private readonly index = new Map<string, BranchIndex>()

  constructor(private readonly git: GitService) {}

  private branchKey(projectId: string, branch: string): string {
    return `${projectId}/${branch}`
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  async findAll(projectId: string, branch: string, filters: RequirementFilters = {}): Promise<Requirement[]> {
    const idx = await this.getOrBuild(projectId, branch)
    let results = Array.from(idx.requirements.values())

    if (filters.objectTypeRef) results = results.filter((r) => r.objectTypeRef === filters.objectTypeRef)
    if (filters.status) results = results.filter((r) => r.status === filters.status)
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

  async findById(projectId: string, branch: string, id: string): Promise<Requirement | null> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.requirements.get(id) ?? null
  }

  async findLinks(projectId: string, branch: string, requirementId: string): Promise<ObjectLink[]> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.links.filter((l) => l.sourceId === requirementId || l.targetId === requirementId)
  }

  async findAllLinks(projectId: string, branch: string): Promise<ObjectLink[]> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.links
  }

  async findLinksNeedingRevalidation(projectId: string, branch: string): Promise<ObjectLink[]> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.links.filter((l) => l.needsRevalidation)
  }

  // Called after a git commit — updates the in-memory state without full rebuild
  upsert(projectId: string, branch: string, req: Requirement): void {
    const key = this.branchKey(projectId, branch)
    const idx = this.index.get(key)
    if (!idx) return // Will be built on next access

    idx.requirements.set(req.id, req)

    // Sync MiniSearch
    if (idx.search.has(req.id)) {
      idx.search.replace(this.toSearchDoc(req))
    } else {
      idx.search.add(this.toSearchDoc(req))
    }
  }

  upsertLink(projectId: string, branch: string, link: ObjectLink): void {
    const key = this.branchKey(projectId, branch)
    const idx = this.index.get(key)
    if (!idx) return

    const existing = idx.links.findIndex((l) => l.id === link.id)
    if (existing >= 0) idx.links[existing] = link
    else idx.links.push(link)
  }

  // Invalidate so next access triggers a full rebuild from git
  invalidate(projectId: string, branch: string): void {
    this.index.delete(this.branchKey(projectId, branch))
    this.logger.debug(`Index invalidated: ${projectId}/${branch}`)
  }

  invalidateAll(projectId: string): void {
    for (const key of this.index.keys()) {
      if (key.startsWith(`${projectId}/`)) this.index.delete(key)
    }
  }

  // ─── Build ───────────────────────────────────────────────────────────────────

  private async getOrBuild(projectId: string, branch: string): Promise<BranchIndex> {
    const key = this.branchKey(projectId, branch)
    if (!this.index.has(key)) {
      await this.build(projectId, branch)
    }
    return this.index.get(key)!
  }

  async build(projectId: string, branch: string): Promise<void> {
    this.logger.log(`Building index for ${projectId}/${branch}`)
    const start = Date.now()
    try {

    const requirements = new Map<string, Requirement>()

    // List all YAML files in requirements/
    const allFiles = await this.git.listFiles(projectId, branch)
    const reqFiles = allFiles.filter((f) => f.startsWith('requirements/') && f.endsWith('.yaml'))

    // Load requirements
    await Promise.all(
      reqFiles.map(async (file) => {
        const req = await this.git.readYaml<Requirement>(projectId, branch, file)
        if (req?.id) requirements.set(req.id, req)
      }),
    )

    // Load links
    const linksData = await this.git.readYaml<{ links: ObjectLink[] }>(
      projectId,
      branch,
      'links/links.yaml',
    )

    // Build MiniSearch
    const search = new MiniSearch({
      idField: 'id',
      fields: ['title', 'statement', 'rationale'],
      storeFields: ['id', 'objectTypeRef', 'status', 'title'],
      extractField: (doc: unknown, field: string) => {
        const r = doc as Requirement & { statement?: string; rationale?: string }
        if (field === 'statement') return String((r.fields as Record<string, unknown>)?.['statement'] ?? '')
        if (field === 'rationale') return String((r.fields as Record<string, unknown>)?.['rationale'] ?? '')
        return String((r as unknown as Record<string, unknown>)[field] ?? '')
      },
    })
    search.addAll(Array.from(requirements.values()).map(this.toSearchDoc))

    this.index.set(this.branchKey(projectId, branch), {
      requirements,
      links: linksData?.links ?? [],
      search,
      loadedAt: new Date(),
    })

    this.logger.log(`Index built for ${projectId}/${branch} — ${requirements.size} requirements in ${Date.now() - start}ms`)
    } catch (err) {
      this.logger.error(`Failed to build index for ${projectId}/${branch}`, err)
      throw err
    }
  }

  private toSearchDoc(req: Requirement): Record<string, unknown> {
    return {
      id: req.id,
      title: req.title,
      objectTypeRef: req.objectTypeRef,
      status: req.status,
      statement: (req.fields as Record<string, unknown>)?.['statement'] ?? '',
      rationale: (req.fields as Record<string, unknown>)?.['rationale'] ?? '',
    }
  }
}
