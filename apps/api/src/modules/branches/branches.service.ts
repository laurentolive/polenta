import { Injectable } from '@nestjs/common'
import { GitService } from '../git/git.service'
import { ProjectsRegistryService } from '../projects/projects-registry.service'
import { RequirementsIndexService } from '../index/requirements-index.service'
import type { CreateBranchDto } from '@polenta/zod-schemas'
import { randomUUID } from 'crypto'

@Injectable()
export class BranchesService {
  constructor(
    private readonly registry: ProjectsRegistryService,
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
  ) {}

  getAll(projectId: string) {
    return this.registry.getBranches(projectId)
  }

  async create(projectId: string, dto: CreateBranchDto) {
    const fromBranch = dto.fromBranchId
      ? this.registry.getBranch(projectId, dto.fromBranchId)
      : this.registry.getBranchByName(projectId, 'main')!

    const headCommit = await this.git.git(projectId).revparse([fromBranch.gitRef])
    await this.git.createBranch(projectId, dto.name, fromBranch.gitRef)

    const branch = {
      id: randomUUID(),
      name: dto.name,
      gitRef: dto.name,
      parentBranchId: fromBranch.id,
      forkCommitSha: headCommit.trim(),
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
    }

    await this.registry.saveBranch(projectId, branch)
    return branch
  }

  async merge(projectId: string, sourceBranchId: string, targetBranchId: string) {
    const source = this.registry.getBranch(projectId, sourceBranchId)
    const target = this.registry.getBranch(projectId, targetBranchId)

    const result = await this.git.merge(projectId, target.name, source.name)

    if (result.success) {
      await this.registry.saveBranch(projectId, { ...source, status: 'merged' })
      // Invalidate both branches so index is rebuilt from merged state
      this.index.invalidate(projectId, target.name)
      this.index.invalidate(projectId, source.name)
    }

    return result
  }

  async getConflicts(projectId: string, branchId: string) {
    const branch = this.registry.getBranch(projectId, branchId)
    const status = await this.git.git(projectId).status()
    return { branch: branch.name, conflicts: status.conflicted }
  }
}
