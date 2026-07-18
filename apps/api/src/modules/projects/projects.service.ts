import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GitService } from '../git/git.service'
import { ProjectsRegistryService } from './projects-registry.service'
import { RequirementsIndexService } from '../index/requirements-index.service'
import type { CreateProjectDto } from '@polenta/zod-schemas'
import type { Project } from '@polenta/types'
import { simpleGit } from 'simple-git'
import * as path from 'path'
import { randomUUID } from 'crypto'

@Injectable()
export class ProjectsService {
  constructor(
    private readonly registry: ProjectsRegistryService,
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
    private readonly config: ConfigService,
  ) {}

  getAll(): Project[] {
    return this.registry.getAll()
  }

  getOne(id: string): Project {
    return this.registry.getById(id)
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const id = randomUUID()
    const repoPath = this.git.repoPath(id)

    await this.git.initRepo(id)

    // Seed initial structure
    await this.git.writeAndCommit(
      id,
      'main',
      [
        { path: 'config/counters.yaml', content: { nextId: 1, prefixes: {} } },
        { path: 'config/requirement-types.yaml', content: { requirementTypes: [] } },
        { path: 'links/links.yaml', content: { links: [] } },
      ],
      'chore: init project structure',
      { name: 'Polenta System', email: 'system@polenta' },
    )

    const headCommit = await this.git.git(id).revparse(['HEAD'])

    const project: Project = {
      id,
      name: dto.name,
      description: dto.description,
      gitRepoPath: repoPath,
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
    }

    await this.registry.save(project)
    await this.registry.saveBranch(id, {
      id: randomUUID(),
      name: 'main',
      gitRef: 'main',
      parentBranchId: null,
      forkCommitSha: headCommit.trim(),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
    })

    return project
  }

  async fork(sourceProjectId: string, name: string): Promise<Project> {
    const source = this.registry.getById(sourceProjectId)
    const id = randomUUID()
    const reposBase = this.config.getOrThrow('GIT_REPOS_BASE_PATH')
    const forkPath = path.join(reposBase, id)

    await simpleGit().clone(source.gitRepoPath, forkPath)
    const headCommit = await simpleGit(forkPath).revparse(['HEAD'])

    const forked: Project = {
      id,
      name,
      description: `Fork of ${source.name}`,
      gitRepoPath: forkPath,
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
    }

    await this.registry.save(forked)
    await this.registry.saveBranch(id, {
      id: randomUUID(),
      name: 'main',
      gitRef: 'main',
      parentBranchId: null,
      forkCommitSha: headCommit.trim(),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
    })

    return forked
  }
}
