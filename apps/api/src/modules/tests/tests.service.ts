import { Injectable, NotFoundException } from '@nestjs/common'
import { GitService } from '../git/git.service'
import { SchemaService } from '../git/schema.service'
import { ProjectsRegistryService } from '../projects/projects-registry.service'
import { TestsIndexService } from '../index/tests-index.service'
import type { CreateTestCaseDto, UpdateTestCaseDto, ExecuteTestCaseDto } from '@polenta/zod-schemas'
import type { TestCase, TestRun } from '@polenta/types'

@Injectable()
export class TestsService {
  constructor(
    private readonly git: GitService,
    private readonly schema: SchemaService,
    private readonly registry: ProjectsRegistryService,
    private readonly testsIndex: TestsIndexService,
  ) {}

  findAll(projectId: string, branchId: string): Promise<TestCase[]> {
    const branch = this.registry.getBranch(projectId, branchId)
    return this.findTestsForBranch(projectId, branch.name)
  }

  async findOne(projectId: string, branchId: string, id: string): Promise<TestCase> {
    const branch = this.registry.getBranch(projectId, branchId)
    const test = await this.git.readYaml<TestCase>(projectId, branch.name, `tests/${id}.yaml`)
    if (!test) throw new NotFoundException(`Test case ${id} not found`)
    return test
  }

  async findRuns(projectId: string, branchId: string, testCaseId: string): Promise<TestRun[]> {
    const branch = this.registry.getBranch(projectId, branchId)
    const allFiles = await this.git.listFiles(projectId, branch.name)
    const runFiles = allFiles.filter((f) => f.startsWith(`test-runs/${testCaseId}/`) && f.endsWith('.yaml'))

    const runs: TestRun[] = []
    for (const file of runFiles) {
      const run = await this.git.readYaml<TestRun>(projectId, branch.name, file)
      if (run) runs.push(run)
    }
    return runs.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
  }

  async create(projectId: string, branchId: string, dto: CreateTestCaseDto): Promise<TestCase> {
    const branch = this.registry.getBranch(projectId, branchId)
    const testId = await this.nextTestId(projectId, branch.name)
    const now = new Date().toISOString()

    const test: TestCase = {
      id: testId,
      projectId,
      branchId,
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: 'DRAFT',
      preconditions: dto.preconditions ?? '',
      equipment: dto.equipment ?? [],
      steps: dto.steps,
      postconditions: dto.postconditions ?? '',
      fields: dto.fields ?? {},
      createdAt: now,
      createdBy: 'TODO:current-user',
      updatedAt: now,
      updatedBy: 'TODO:current-user',
    }

    const repoDir = await this.resolveRepoDir(projectId, dto.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `tests/${testId}.yaml`, content: test }],
      `feat(${testId}): create test case`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.testsIndex.upsertTestCase(projectId, branch.name, test)
    return test
  }

  async update(projectId: string, branchId: string, id: string, dto: UpdateTestCaseDto): Promise<TestCase> {
    const branch = this.registry.getBranch(projectId, branchId)
    const existing = await this.git.readYaml<TestCase>(projectId, branch.name, `tests/${id}.yaml`)
    if (!existing) throw new NotFoundException(id)

    const now = new Date().toISOString()
    const updated: TestCase = {
      ...existing,
      ...(dto.title && { title: dto.title }),
      ...(dto.objectTypeRef && { objectTypeRef: dto.objectTypeRef }),
      ...(dto.preconditions !== undefined && { preconditions: dto.preconditions }),
      ...(dto.equipment && { equipment: dto.equipment }),
      ...(dto.steps && { steps: dto.steps }),
      ...(dto.postconditions !== undefined && { postconditions: dto.postconditions }),
      fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
      updatedAt: now,
      updatedBy: 'TODO:current-user',
    }

    const repoDir = await this.resolveRepoDir(projectId, existing.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `tests/${id}.yaml`, content: updated }],
      `chore(${id}): update test case`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.testsIndex.upsertTestCase(projectId, branch.name, updated)
    return updated
  }

  async execute(
    projectId: string,
    branchId: string,
    testCaseId: string,
    dto: ExecuteTestCaseDto,
  ): Promise<TestRun> {
    const branch = this.registry.getBranch(projectId, branchId)
    const testCase = await this.git.readYaml<TestCase>(projectId, branch.name, `tests/${testCaseId}.yaml`)
    if (!testCase) throw new NotFoundException(testCaseId)

    const runId = await this.nextRunId(projectId, branch.name, testCaseId)
    const now = new Date().toISOString()

    // Determine overall result based on step results
    const stepResults = dto.stepResults.sort((a, b) => a.order - b.order)
    let result: 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE' = 'PASS'
    if (stepResults.some((s) => s.result === 'FAIL')) result = 'FAIL'
    else if (stepResults.some((s) => s.result === 'BLOCKED')) result = 'BLOCKED'
    else if (stepResults.some((s) => s.result === 'NOT_EXECUTED')) result = 'INCOMPLETE'

    const run: TestRun = {
      id: runId,
      testCaseId,
      campaignRunId: null,
      result,
      executedAt: now,
      executedBy: 'TODO:current-user',
      duration: 0,
      equipmentUsed: dto.equipmentUsed ?? [],
      stepResults: stepResults.map((s) => ({ ...s, executedAt: now })),
      notes: dto.notes ?? '',
    }

    // Test runs are stored in the same repo as the test case
    const repoDir = await this.resolveRepoDir(projectId, testCase.objectTypeRef)
    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `test-runs/${testCaseId}/${runId}.yaml`, content: run }],
      `test(${testCaseId}): execute test run ${runId}`,
      { name: 'Polenta User', email: 'user@polenta' },
      repoDir,
    )

    this.testsIndex.upsertRun(projectId, branch.name, run)
    return run
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

  private async findTestsForBranch(projectId: string, branch: string): Promise<TestCase[]> {
    const allFiles = await this.git.listFiles(projectId, branch)
    const testFiles = allFiles.filter((f) => f.startsWith('tests/') && f.endsWith('.yaml'))

    const tests: TestCase[] = []
    for (const file of testFiles) {
      const test = await this.git.readYaml<TestCase>(projectId, branch, file)
      if (test?.id) tests.push(test)
    }
    return tests.sort((a, b) => a.id.localeCompare(b.id))
  }

  private async nextTestId(projectId: string, branch: string): Promise<string> {
    const counters = await this.git.readYaml<{ nextId: number; prefixes: Record<string, string> }>(
      projectId,
      branch,
      'config/counters.yaml',
    ) ?? { nextId: 1, prefixes: {} }

    const prefix = 'TEST'
    const id = `${prefix}-${String(counters.nextId).padStart(4, '0')}`

    await this.git.writeAndCommit(
      projectId,
      branch,
      [{ path: 'config/counters.yaml', content: { ...counters, nextId: counters.nextId + 1 } }],
      `chore: increment test id counter`,
      { name: 'Polenta System', email: 'system@polenta' },
    )

    return id
  }

  private async nextRunId(projectId: string, branch: string, testCaseId: string): Promise<string> {
    const allFiles = await this.git.listFiles(projectId, branch)
    const existingRuns = allFiles.filter((f) => f.startsWith(`test-runs/${testCaseId}/`)).length
    return `${testCaseId}-run-${String(existingRuns + 1).padStart(4, '0')}`
  }
}
