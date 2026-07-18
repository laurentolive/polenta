import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { Project } from '@polenta/types'

interface ProjectRecord extends Project {
  branches: BranchRecord[]
}

export interface BranchRecord {
  id: string
  name: string
  gitRef: string
  parentBranchId: string | null
  forkCommitSha: string | null
  status: 'active' | 'merged' | 'abandoned'
  createdAt: string
  createdBy: string
}

@Injectable()
export class ProjectsRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsRegistryService.name)
  private readonly registryPath: string
  private projects: ProjectRecord[] = []

  constructor(private readonly config: ConfigService) {
    this.registryPath = config.get('PROJECTS_REGISTRY_PATH') ?? path.join(process.cwd(), 'data', 'projects.json')
  }

  async onModuleInit() {
    await this.load()
  }

  // ─── Projects ────────────────────────────────────────────────────────────────

  getAll(): Project[] {
    return this.projects.map(this.toProject)
  }

  getById(id: string): Project {
    const p = this.projects.find((p) => p.id === id)
    if (!p) throw new NotFoundException(`Project ${id} not found`)
    return this.toProject(p)
  }

  async save(project: Project): Promise<Project> {
    const existing = this.projects.findIndex((p) => p.id === project.id)
    if (existing >= 0) {
      this.projects[existing] = { ...this.projects[existing], ...project }
    } else {
      this.projects.push({ ...project, branches: [] })
    }
    await this.persist()
    return project
  }

  async delete(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id)
    await this.persist()
  }

  // ─── Branches ────────────────────────────────────────────────────────────────

  getBranches(projectId: string): BranchRecord[] {
    return this.projects.find((p) => p.id === projectId)?.branches ?? []
  }

  getBranch(projectId: string, branchId: string): BranchRecord {
    const branch = this.getBranches(projectId).find((b) => b.id === branchId)
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found in project ${projectId}`)
    return branch
  }

  getBranchByName(projectId: string, name: string): BranchRecord | null {
    return this.getBranches(projectId).find((b) => b.name === name) ?? null
  }

  async saveBranch(projectId: string, branch: BranchRecord): Promise<BranchRecord> {
    const project = this.projects.find((p) => p.id === projectId)
    if (!project) throw new NotFoundException(`Project ${projectId} not found`)

    const idx = project.branches.findIndex((b) => b.id === branch.id)
    if (idx >= 0) project.branches[idx] = branch
    else project.branches.push(branch)

    await this.persist()
    return branch
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8')
      this.projects = JSON.parse(raw)
      this.logger.log(`Loaded ${this.projects.length} projects from registry`)
    } catch {
      this.projects = []
      await this.persist() // create empty file
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true })
    await fs.writeFile(this.registryPath, JSON.stringify(this.projects, null, 2), 'utf-8')
  }

  private toProject(p: ProjectRecord): Project {
    return { id: p.id, name: p.name, description: p.description, gitRepoPath: p.gitRepoPath, createdAt: p.createdAt, createdBy: p.createdBy }
  }
}
