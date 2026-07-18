import type { ProjectSchema, TestCase, TestRun } from '@polenta/types'
import type { CreateTestCaseDto, UpdateTestCaseDto, ExecuteTestCaseDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { nextCounterId } from './id-counter.util'

export class TestsService {
  constructor(
    private readonly git: GitService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
  ) {}

  findAll(repoPath: string): Promise<TestCase[]> {
    return this.testsIndex.findAll(repoPath)
  }

  async findOne(repoPath: string, id: string): Promise<TestCase> {
    const tc = await this.testsIndex.findById(repoPath, id)
    if (!tc) throw new Error(`Test case ${id} not found`)
    return tc
  }

  async findRuns(repoPath: string, testCaseId: string): Promise<TestRun[]> {
    return this.testsIndex.findRuns(repoPath, testCaseId)
  }

  async create(repoPath: string, dto: CreateTestCaseDto, workspaceDir?: string): Promise<TestCase> {
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    const testId = await this.nextTestId(repoPath, dto.objectTypeRef)

    const test: TestCase = {
      id: testId,
      projectId: '',
      branchId: '',
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: 'draft',
      preconditions: dto.preconditions ?? '',
      equipment: dto.equipment ?? [],
      steps: dto.steps,
      postconditions: dto.postconditions ?? '',
      fields: dto.fields ?? {},
      // Fichier neuf, aucun commit ne le touche encore — pas d'appel git.fileHistory()
      // ici, il renverrait `null` de toute façon (T112).
      createdAt: null,
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
    }

    await this.git.writeYaml(targetRepo, `tests/${testId}.yaml`, omitAuditFields(test))
    this.testsIndex.upsertTestCase(repoPath, test)
    return test
  }

  async update(repoPath: string, id: string, dto: UpdateTestCaseDto, workspaceDir?: string): Promise<TestCase> {
    const existing = await this.testsIndex.findById(repoPath, id)
    if (!existing) throw new Error(`Test case ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    // createdAt/createdBy/updatedAt/updatedBy viennent de `...existing` (dérivés du
    // dernier commit par l'index) — cette édition n'étant pas commitée, ils ne changent
    // pas ici (T112).
    const updated: TestCase = {
      ...existing,
      ...(dto.title && { title: dto.title }),
      ...(dto.objectTypeRef && { objectTypeRef: dto.objectTypeRef }),
      ...(dto.status && { status: dto.status }),
      ...(dto.preconditions !== undefined && { preconditions: dto.preconditions }),
      ...(dto.equipment && { equipment: dto.equipment }),
      ...(dto.steps && { steps: dto.steps }),
      ...(dto.postconditions !== undefined && { postconditions: dto.postconditions }),
      fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
    }

    await this.git.writeYaml(targetRepo, `tests/${id}.yaml`, omitAuditFields(updated))
    this.testsIndex.upsertTestCase(repoPath, updated)
    return updated
  }

  async openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<TestCase> {
    const existing = await this.testsIndex.findById(repoPath, id)
    if (!existing) throw new Error(`Test case ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    const updated: TestCase = {
      ...existing,
      status: targetStatus,
      version: (existing.version ?? 0) + 1,
    }

    await this.git.writeYaml(targetRepo, `tests/${id}.yaml`, omitAuditFields(updated))
    this.testsIndex.upsertTestCase(repoPath, updated)
    return updated
  }

  async execute(repoPath: string, testCaseId: string, dto: ExecuteTestCaseDto, workspaceDir?: string): Promise<TestRun> {
    // Resolve component repo from the test case's objectTypeRef (look up index first)
    const indexed = await this.testsIndex.findById(repoPath, testCaseId)
    const targetRepo = indexed
      ? (await this.schema.resolveComponentRepoPath(repoPath, indexed.objectTypeRef, workspaceDir)) ?? repoPath
      : repoPath

    const testCase = indexed ?? await this.git.readYaml<TestCase>(targetRepo, `tests/${testCaseId}.yaml`)
    if (!testCase) throw new Error(`Test case ${testCaseId} not found`)

    const runId = await this.nextRunId(targetRepo, testCaseId)
    const now = new Date().toISOString()

    // Determine overall result: explicit override takes priority, otherwise computed from steps
    const stepResults = dto.stepResults.sort((a, b) => a.order - b.order)
    let result: 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE' = dto.result ?? 'PASS'
    if (!dto.result) {
      if (stepResults.some((s) => s.result === 'FAIL')) result = 'FAIL'
      else if (stepResults.some((s) => s.result === 'BLOCKED')) result = 'BLOCKED'
      else if (stepResults.some((s) => s.result === 'NOT_EXECUTED')) result = 'INCOMPLETE'
    }

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

    await this.git.writeYaml(targetRepo, `test-runs/${testCaseId}/${runId}.yaml`, run)
    this.testsIndex.upsertRun(repoPath, run)
    return run
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async nextTestId(repoPath: string, objectTypeRef: string): Promise<string> {
    // Scoped by node via the shared lookup — see requirements.service.ts's nextId() for why
    // a flat search across every node's objectTypes is wrong (T113: sibling SystemNodes can
    // legitimately reuse the same type name with different prefixes).
    const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    const prefix = (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined)
      ?? typeName.slice(0, 6).toUpperCase()

    return nextCounterId(this.git, repoPath, prefix, 'tests')
  }

  private async nextRunId(repoPath: string, testCaseId: string): Promise<string> {
    const existingRuns = await this.git.listFiles(repoPath, `test-runs/${testCaseId}`)
    return `${testCaseId}-run-${String(existingRuns.length + 1).padStart(4, '0')}`
  }
}
