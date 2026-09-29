import type { TestCase, TestRun } from '@polenta/types'
import type { GitService } from './git.service'

interface TestRepoIndex {
  testCases: Map<string, TestCase>
  runsByTestCase: Map<string, TestRun[]>  // sorted desc by executedAt
  loadedAt: Date
}

export class TestsIndexService {
  private readonly index = new Map<string, TestRepoIndex>()

  constructor(private readonly git: GitService) {}

  async findAll(repoPath: string): Promise<TestCase[]> {
    const idx = await this.getOrBuild(repoPath)
    return Array.from(idx.testCases.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  async findById(repoPath: string, id: string): Promise<TestCase | null> {
    const idx = await this.getOrBuild(repoPath)
    return idx.testCases.get(id) ?? null
  }

  async findRuns(repoPath: string, tcId: string): Promise<TestRun[]> {
    const idx = await this.getOrBuild(repoPath)
    return idx.runsByTestCase.get(tcId) ?? []
  }

  async getLatestRunMap(repoPath: string): Promise<Map<string, TestRun>> {
    const idx = await this.getOrBuild(repoPath)
    const result = new Map<string, TestRun>()
    for (const [tcId, runs] of idx.runsByTestCase.entries()) {
      if (runs.length > 0) result.set(tcId, runs[0])
    }
    return result
  }

  /** T179 — tous les runs par test, du plus récent au plus ancien (couverture par exigence). */
  async getRunsMap(repoPath: string): Promise<Map<string, TestRun[]>> {
    const idx = await this.getOrBuild(repoPath)
    return new Map(idx.runsByTestCase)
  }

  upsertTestCase(repoPath: string, tc: TestCase): void {
    const idx = this.index.get(repoPath)
    if (!idx) return
    idx.testCases.set(tc.id, tc)
  }

  upsertRun(repoPath: string, run: TestRun): void {
    const idx = this.index.get(repoPath)
    if (!idx) return
    const runs = idx.runsByTestCase.get(run.testCaseId) ?? []
    const existing = runs.findIndex((r) => r.id === run.id)
    if (existing >= 0) runs[existing] = run
    else runs.push(run)
    runs.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
    idx.runsByTestCase.set(run.testCaseId, runs)
  }

  invalidate(repoPath: string): void {
    this.index.delete(repoPath)
    console.log(`[TestsIndex] Index invalidated: ${repoPath}`)
  }

  invalidateFile(repoPath: string, filePath: string): void {
    if (filePath.startsWith('tests/') || filePath.startsWith('test-runs/')) {
      this.invalidate(repoPath)
    }
  }

  // ─── Build ───────────────────────────────────────────────────────────────────

  private async getOrBuild(repoPath: string): Promise<TestRepoIndex> {
    if (!this.index.has(repoPath)) {
      await this.build(repoPath)
    }
    return this.index.get(repoPath)!
  }

  async build(repoPath: string): Promise<void> {
    console.log(`[TestsIndex] Building tests index for ${repoPath}`)
    const testCases = new Map<string, TestCase>()
    const runsByTestCase = new Map<string, TestRun[]>()

    const testFiles = await this.git.listFiles(repoPath, 'tests')
    const runFiles = await this.git.listFiles(repoPath, 'test-runs')

    // createdAt/createdBy/updatedAt/updatedBy are derived from the file's git log
    // (T112), never trusted from the YAML itself: overwritten unconditionally below,
    // whatever stale/absent keys the file may still have.
    // T142 — one batched history walk for every file under `tests/`, instead of one
    // `git.fileHistory()` (full history re-walk) per file: see GitService.fileHistoryMap().
    const historyMap = await this.git.fileHistoryMap(repoPath, 'tests')
    await Promise.all(
      testFiles
        .filter((f) => f.endsWith('.yaml'))
        .map(async (file) => {
          const tc = await this.git.readYaml<TestCase>(repoPath, file)
          if (!tc?.id) return
          const history = historyMap.get(file)
          testCases.set(tc.id, {
            ...tc,
            createdAt: history?.createdAt ?? null,
            createdBy: history?.createdBy ?? null,
            updatedAt: history?.updatedAt ?? null,
            updatedBy: history?.updatedBy ?? null,
          })
        }),
    )

    await Promise.all(
      runFiles
        .filter((f) => f.endsWith('.yaml'))
        .map(async (file) => {
          const run = await this.git.readYaml<TestRun>(repoPath, file)
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

    this.index.set(repoPath, { testCases, runsByTestCase, loadedAt: new Date() })
    console.log(`[TestsIndex] Built for ${repoPath} — ${testCases.size} tests`)
  }
}
