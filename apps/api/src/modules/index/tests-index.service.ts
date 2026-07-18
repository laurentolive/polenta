import { Injectable, Logger } from '@nestjs/common'
import type { TestCase, TestRun } from '@polenta/types'
import { GitService } from '../git/git.service'

interface TestBranchIndex {
  testCases: Map<string, TestCase>
  runsByTestCase: Map<string, TestRun[]>  // sorted desc by executedAt
  loadedAt: Date
}

@Injectable()
export class TestsIndexService {
  private readonly logger = new Logger(TestsIndexService.name)
  private readonly index = new Map<string, TestBranchIndex>()

  constructor(private readonly git: GitService) {}

  private key(projectId: string, branch: string): string {
    return `${projectId}/${branch}`
  }

  async findAll(projectId: string, branch: string): Promise<TestCase[]> {
    const idx = await this.getOrBuild(projectId, branch)
    return Array.from(idx.testCases.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  async findById(projectId: string, branch: string, id: string): Promise<TestCase | null> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.testCases.get(id) ?? null
  }

  async findRuns(projectId: string, branch: string, tcId: string): Promise<TestRun[]> {
    const idx = await this.getOrBuild(projectId, branch)
    return idx.runsByTestCase.get(tcId) ?? []
  }

  async getLatestRunMap(projectId: string, branch: string): Promise<Map<string, TestRun>> {
    const idx = await this.getOrBuild(projectId, branch)
    const result = new Map<string, TestRun>()
    for (const [tcId, runs] of idx.runsByTestCase.entries()) {
      if (runs.length > 0) result.set(tcId, runs[0])
    }
    return result
  }

  upsertTestCase(projectId: string, branch: string, tc: TestCase): void {
    const idx = this.index.get(this.key(projectId, branch))
    if (!idx) return
    idx.testCases.set(tc.id, tc)
  }

  upsertRun(projectId: string, branch: string, run: TestRun): void {
    const idx = this.index.get(this.key(projectId, branch))
    if (!idx) return
    const runs = idx.runsByTestCase.get(run.testCaseId) ?? []
    const existing = runs.findIndex((r) => r.id === run.id)
    if (existing >= 0) runs[existing] = run
    else runs.push(run)
    runs.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
    idx.runsByTestCase.set(run.testCaseId, runs)
  }

  invalidate(projectId: string, branch: string): void {
    this.index.delete(this.key(projectId, branch))
    this.logger.debug(`Tests index invalidated: ${projectId}/${branch}`)
  }

  private async getOrBuild(projectId: string, branch: string): Promise<TestBranchIndex> {
    const key = this.key(projectId, branch)
    if (!this.index.has(key)) {
      await this.build(projectId, branch)
    }
    return this.index.get(key)!
  }

  async build(projectId: string, branch: string): Promise<void> {
    this.logger.log(`Building tests index for ${projectId}/${branch}`)
    const testCases = new Map<string, TestCase>()
    const runsByTestCase = new Map<string, TestRun[]>()

    const allFiles = await this.git.listFiles(projectId, branch)

    await Promise.all(
      allFiles
        .filter((f) => f.startsWith('tests/') && f.endsWith('.yaml'))
        .map(async (file) => {
          const tc = await this.git.readYaml<TestCase>(projectId, branch, file)
          if (tc?.id) testCases.set(tc.id, tc)
        }),
    )

    await Promise.all(
      allFiles
        .filter((f) => f.startsWith('test-runs/') && f.endsWith('.yaml'))
        .map(async (file) => {
          const run = await this.git.readYaml<TestRun>(projectId, branch, file)
          if (!run?.id) return
          const runs = runsByTestCase.get(run.testCaseId) ?? []
          runs.push(run)
          runsByTestCase.set(run.testCaseId, runs)
        }),
    )

    for (const [tcId, runs] of runsByTestCase.entries()) {
      runs.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
      runsByTestCase.set(tcId, runs)
    }

    this.index.set(this.key(projectId, branch), { testCases, runsByTestCase, loadedAt: new Date() })
    this.logger.log(`Tests index built for ${projectId}/${branch} — ${testCases.size} tests`)
  }
}
