import type { ProjectSchema, Requirement } from '@polenta/types'
import type { CreateRequirementDto, UpdateRequirementDto, TransitionRequirementDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { RequirementsIndexService, RequirementFilters } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { nextCounterId } from './id-counter.util'

export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
    private readonly schema: SchemaService,
  ) {}

  findAll(repoPath: string, filters: RequirementFilters): Promise<Requirement[]> {
    return this.index.findAll(repoPath, filters)
  }

  async findOne(repoPath: string, id: string): Promise<Requirement> {
    const req = await this.index.findById(repoPath, id)
    if (!req) throw new Error(`Requirement ${id} not found`)
    return req
  }

  findVersions(repoPath: string, id: string) {
    return this.index.findVersions(repoPath, id)
  }

  findLinks(repoPath: string, id: string) {
    return this.index.findLinks(repoPath, id)
  }

  findAllLinks(repoPath: string) {
    return this.index.findAllLinks(repoPath)
  }

  createLink(repoPath: string, data: { type: string; sourceId: string; targetId: string }) {
    return this.index.createLink(repoPath, data)
  }

  deleteLink(repoPath: string, linkId: string) {
    return this.index.deleteLink(repoPath, linkId)
  }

  async create(repoPath: string, dto: CreateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    const reqId = await this.nextId(repoPath, dto.objectTypeRef)

    const req: Requirement = {
      id: reqId,
      projectId: '',
      branchId: '',
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: 'draft',
      version: 1,
      fields: dto.fields ?? {},
      jiraLinks: [],
      // Fichier neuf, aucun commit ne le touche encore — pas d'appel git.fileHistory()
      // ici, il renverrait `null` de toute façon (T112).
      createdAt: null,
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
    }

    await this.git.writeYaml(targetRepo, `requirements/${reqId}.yaml`, omitAuditFields(req))
    this.index.upsert(repoPath, req)
    return req
  }

  async update(repoPath: string, id: string, dto: UpdateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    // createdAt/createdBy/updatedAt/updatedBy viennent de `...existing` (dérivés du
    // dernier commit par l'index) — cette édition n'étant pas commitée, ils ne changent
    // pas ici (T112).
    const updated: Requirement = {
      ...existing,
      ...(dto.title && { title: dto.title }),
      fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
  }

  async openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    const updated: Requirement = {
      ...existing,
      status: targetStatus,
      version: (existing.version ?? 0) + 1,
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
  }

  async transition(repoPath: string, id: string, dto: TransitionRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    const updated: Requirement = {
      ...existing,
      status: dto.toStatus,
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async nextId(repoPath: string, objectTypeRef: string): Promise<string> {
    const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef

    // Scoped by node (not a flat search across every node's objectTypes) via the same
    // lookup requirements-index/query-engine already rely on — a type name like "exigence"
    // is only unique *within* its own node, not across the whole schema (T113: sibling
    // SystemNodes can legitimately reuse the same type name with different prefixes).
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    const prefix = (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined)
      ?? typeName.slice(0, 6).toUpperCase()

    return nextCounterId(this.git, repoPath, prefix, 'requirements')
  }
}
