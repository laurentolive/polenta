import { Injectable, NotFoundException } from '@nestjs/common'
import { GitService } from '../git/git.service'
import { SchemaService } from '../git/schema.service'
import { RequirementsIndexService } from '../index/requirements-index.service'
import { ProjectsRegistryService } from '../projects/projects-registry.service'
import type { CreateRequirementDto, UpdateRequirementDto, TransitionRequirementDto } from '@polenta/zod-schemas'
import type { Requirement } from '@polenta/types'
import type { RequirementFilters } from '../index/requirements-index.service'

@Injectable()
export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly schema: SchemaService,
    private readonly index: RequirementsIndexService,
    private readonly registry: ProjectsRegistryService,
  ) {}

  findAll(projectId: string, branchId: string, filters: RequirementFilters) {
    const branch = this.registry.getBranch(projectId, branchId)
    return this.index.findAll(projectId, branch.name, filters)
  }

  async findOne(projectId: string, branchId: string, id: string): Promise<Requirement> {
    const branch = this.registry.getBranch(projectId, branchId)
    const req = await this.index.findById(projectId, branch.name, id)
    if (!req) throw new NotFoundException(`Requirement ${id} not found`)
    return req
  }

  findLinks(projectId: string, branchId: string, id: string) {
    const branch = this.registry.getBranch(projectId, branchId)
    return this.index.findLinks(projectId, branch.name, id)
  }

  async create(projectId: string, branchId: string, dto: CreateRequirementDto): Promise<Requirement> {
    const branch = this.registry.getBranch(projectId, branchId)
    const reqId = await this.nextId(projectId, branch.name, dto.objectTypeRef)
    const now = new Date().toISOString()

    const req: Requirement = {
      id: reqId,
      projectId,
      branchId,
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: 'DRAFT',
      version: 1,
      fields: dto.fields ?? {},
      jiraLinks: [],
      createdAt: now,
      createdBy: 'TODO:current-user',
      updatedAt: now,
      updatedBy: 'TODO:current-user',
    }

    const repoDir = await this.resolveRepoDir(projectId, dto.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `requirements/${reqId}.yaml`, content: req }],
      `feat(${reqId}): create requirement`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.index.upsert(projectId, branch.name, req)
    return req
  }

  async update(projectId: string, branchId: string, id: string, dto: UpdateRequirementDto): Promise<Requirement> {
    const branch = this.registry.getBranch(projectId, branchId)
    const existing = await this.index.findById(projectId, branch.name, id)
    if (!existing) throw new NotFoundException(id)

    const now = new Date().toISOString()
    const updated: Requirement = {
      ...existing,
      ...(dto.title && { title: dto.title }),
      fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
      updatedAt: now,
      updatedBy: 'TODO:current-user',
    }

    const repoDir = await this.resolveRepoDir(projectId, existing.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `requirements/${id}.yaml`, content: updated }],
      `chore(${id}): update fields`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.index.upsert(projectId, branch.name, updated)
    return updated
  }

  async transition(projectId: string, branchId: string, id: string, dto: TransitionRequirementDto): Promise<Requirement> {
    const branch = this.registry.getBranch(projectId, branchId)
    const existing = await this.index.findById(projectId, branch.name, id)
    if (!existing) throw new NotFoundException(id)

    const now = new Date().toISOString()
    const updated: Requirement = {
      ...existing,
      status: dto.toStatus,
      updatedAt: now,
      updatedBy: 'TODO:current-user',
    }

    const repoDir = await this.resolveRepoDir(projectId, existing.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `requirements/${id}.yaml`, content: updated }],
      `chore(${id}): transition to ${dto.toStatus}`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.index.upsert(projectId, branch.name, updated)
    return updated
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Resolves the target repo directory for a given objectTypeRef.
   * For local nodes (no url) → returns undefined (GitService uses the product repo by default).
   * For submodule nodes (url present) → returns the component repo path.
   */
  private async resolveRepoDir(projectId: string, objectTypeRef: string): Promise<string | undefined> {
    const nodeName = this.schema.parseNodeName(objectTypeRef)
    const repoDir = await this.schema.repoPathForNode(projectId, nodeName)
    const productRepo = this.git.repoPath(projectId)
    return repoDir !== productRepo ? repoDir : undefined
  }

  private async nextId(projectId: string, branch: string, objectTypeRef: string): Promise<string> {
    const counters = await this.git.readYaml<{ nextId: number; prefixes: Record<string, string> }>(
      projectId,
      branch,
      'config/counters.yaml',
    ) ?? { nextId: 1, prefixes: {} }

    const prefix = counters.prefixes[objectTypeRef] ?? objectTypeRef.split('::').pop()!.slice(0, 4).toUpperCase()
    const id = `${prefix}-${String(counters.nextId).padStart(4, '0')}`

    await this.git.writeAndCommit(
      projectId,
      branch,
      [{ path: 'config/counters.yaml', content: { ...counters, nextId: counters.nextId + 1 } }],
      `chore: increment id counter`,
      { name: 'Polenta System', email: 'system@polenta' },
    )

    return id
  }
}
