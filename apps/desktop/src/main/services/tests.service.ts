import { randomUUID } from 'crypto'
import { initialStatus, isUnknownStatus, renameFieldKeys } from '@polenta/types'
import type { FieldRename, FieldRenameResult, ObjectHistory, ObjectTypeDefinition, ProjectSchema, TestCase, TestRun } from '@polenta/types'
import type { CreateTestCaseDto, UpdateTestCaseDto, ExecuteTestCaseDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TreeService } from './tree.service'
import { RevalidationService } from './revalidation.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef, resolveObjectTypeLocation } from './schema-lookup.util'
import { nextCounterId } from './id-counter.util'
import { withKeyLock } from './serialize-writes.util'
import { mergeFields } from './field-merge.util'
import type { HistoryService } from './history.service'

export class TestsService {
  constructor(
    private readonly git: GitService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly tree?: TreeService,
    private readonly revalidation?: RevalidationService,
    private readonly history?: HistoryService,
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
    // GH149 — cf. RequirementsService.create : statut initial lu dans le schéma.
    const typeDef = await this.readTypeDef(repoPath, dto.objectTypeRef)
    if (dto.status && isUnknownStatus(typeDef, dto.status)) {
      throw new Error(`Statut inconnu pour le type ${dto.objectTypeRef} : "${dto.status}"`)
    }
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    const testId = await this.nextTestId(repoPath, targetRepo, dto.objectTypeRef)

    // See RequirementsService.create — same reconciled-but-not-guaranteed-unique
    // counter, same silent-overwrite risk in writeYaml().
    if (await this.git.fileExists(targetRepo, `tests/${testId}.yaml`)) {
      throw new Error(`Test case ${testId} already exists`)
    }

    const test: TestCase = {
      id: testId,
      projectId: '',
      branchId: '',
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: dto.status ?? initialStatus(typeDef),
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

    const created = await this.persist(repoPath, targetRepo, null, test)
    await this.appendToTree(targetRepo, dto.objectTypeRef, created.id, created.title)
    return created
  }

  // T159 — cf. RequirementsService : sérialise les read-modify-write concurrents sur le
  // fichier du cas de test.
  async update(
    repoPath: string, id: string, dto: UpdateTestCaseDto, workspaceDir?: string,
    /** GH150 — `update_tests` (MCP) : une clé de `fields` à `null` retire le champ. */
    opts: { removeNullFields?: boolean } = {},
  ): Promise<TestCase> {
    const { updated, leftApproval } = await withKeyLock(`${repoPath}::tests/${id}`, async () => {
      const existing = await this.testsIndex.findById(repoPath, id)
      if (!existing) throw new Error(`Test case ${id} not found`)

      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      // createdAt/createdBy/updatedAt/updatedBy viennent de `...existing` (dérivés du
      // dernier commit par l'index) — cette édition n'étant pas commitée, ils ne changent
      // pas ici (T112).
      const updated = await this.persist(repoPath, targetRepo, existing, {
        ...existing,
        ...(dto.title && { title: dto.title }),
        ...(dto.objectTypeRef && { objectTypeRef: dto.objectTypeRef }),
        ...(dto.status && { status: dto.status }),
        ...(dto.preconditions !== undefined && { preconditions: dto.preconditions }),
        ...(dto.equipment && { equipment: dto.equipment }),
        ...(dto.steps && { steps: dto.steps }),
        ...(dto.postconditions !== undefined && { postconditions: dto.postconditions }),
        fields: opts.removeNullFields
          ? mergeFields(existing.fields as Record<string, unknown>, dto.fields)
          : { ...(existing.fields as object), ...(dto.fields ?? {}) },
      })
      // T172 — changement de statut direct (colonne Statut de la vue Excel) quittant l'approbation.
      const leftApproval = !!dto.status && RevalidationService.leavesApproval(
        await this.readTypeDef(repoPath, existing.objectTypeRef), existing.status, dto.status)
      return { updated, leftApproval }
    })
    // T172 — hors du verrou de ce test (pas de verrous imbriqués avec ceux des pairs).
    if (leftApproval) await this.revalidation?.markImpactedBy(repoPath, id, workspaceDir)
    return updated
  }

  async openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<TestCase> {
    const { updated, leftApproval } = await withKeyLock(`${repoPath}::tests/${id}`, async () => {
      const existing = await this.testsIndex.findById(repoPath, id)
      if (!existing) throw new Error(`Test case ${id} not found`)

      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      const updated = await this.persist(repoPath, targetRepo, existing, {
        ...existing,
        status: targetStatus,
        version: (existing.version ?? 0) + 1,
      })
      const leftApproval = RevalidationService.leavesApproval(
        await this.readTypeDef(repoPath, existing.objectTypeRef), existing.status, targetStatus)
      return { updated, leftApproval }
    })
    // T172 — hors du verrou de ce test (pas de verrous imbriqués avec ceux des pairs).
    if (leftApproval) await this.revalidation?.markImpactedBy(repoPath, id, workspaceDir)
    return updated
  }

  /** GH77 — cf. `RequirementsService.renameFieldKeys`. */
  async renameFieldKeys(repoPath: string, objectTypeRef: string, renames: FieldRename[], result: FieldRenameResult): Promise<void> {
    return this.rewriteObjects(repoPath, objectTypeRef, o => renameFieldKeys(o, renames), result)
  }

  /** GH77/GH82 — cf. `RequirementsService.rewriteObjects`. */
  async rewriteObjects(
    repoPath: string, objectTypeRef: string,
    transform: (obj: TestCase) => TestCase | 'conflict' | null, result: FieldRenameResult,
  ): Promise<void> {
    const matching = (await this.testsIndex.findAll(repoPath)).filter(t => t.objectTypeRef === objectTypeRef)
    for (const { id } of matching) {
      try {
        await withKeyLock(`${repoPath}::tests/${id}`, async () => {
          const existing = await this.testsIndex.findById(repoPath, id)
          const next = existing ? transform(existing) : null
          if (next === 'conflict') result.skipped.push({ id, reason: 'target_exists' })
          if (!next || next === 'conflict') return
          await this.persist(repoPath, repoPath, next, next, { raw: true })
          result.migrated.push(id)
        })
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /** GH77 — cf. `RequirementsService.updateHistory`. */
  async updateHistory(repoPath: string, id: string, next: (current: TestCase) => ObjectHistory | null): Promise<boolean> {
    return withKeyLock(`${repoPath}::tests/${id}`, async () => {
      const existing = await this.testsIndex.findById(repoPath, id)
      const history = existing ? next(existing) : null
      if (!existing || !history) return false
      const updated = { ...existing, history }
      await this.persist(repoPath, repoPath, updated, updated, { raw: true })
      return true
    })
  }

  /**
   * Seule écriture d'un fichier de cas de test (GH77) : complète l'historique des champs suivis
   * (`before` null = création), écrit sans les champs d'audit, met l'index à jour.
   */
  private async persist(
    repoPath: string, targetRepo: string, before: TestCase | null, after: TestCase,
    /** Écriture qui ne change aucune valeur (renommage, reprise git) : `history` écrit tel quel. */
    opts: { raw?: boolean } = {},
  ): Promise<TestCase> {
    const stamped = this.history && !opts.raw
      ? await this.history.stamp(repoPath, after.objectTypeRef, before, after, before ?? { updatedAt: null, updatedBy: null }, targetRepo)
      : after
    await this.git.writeYaml(targetRepo, `tests/${stamped.id}.yaml`, omitAuditFields(stamped))
    this.testsIndex.upsertTestCase(repoPath, stamped)
    return stamped
  }

  /** Définition du type de l'objet dans le schéma du repo ouvert (null si non résolvable). */
  private async readTypeDef(repoPath: string, objectTypeRef: string): Promise<ObjectTypeDefinition | null> {
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    return resolved && resolved !== 'unresolvable' ? resolved : null
  }

  async execute(repoPath: string, testCaseId: string, dto: ExecuteTestCaseDto, workspaceDir?: string): Promise<TestRun> {
    // Resolve component repo from the test case's objectTypeRef (look up index first)
    const indexed = await this.testsIndex.findById(repoPath, testCaseId)
    const targetRepo = indexed
      ? (await this.schema.resolveComponentRepoPath(repoPath, indexed.objectTypeRef, workspaceDir)) ?? repoPath
      : repoPath

    const testCase = indexed ?? await this.git.readYaml<TestCase>(targetRepo, `tests/${testCaseId}.yaml`)
    if (!testCase) throw new Error(`Test case ${testCaseId} not found`)

    // GH73 — le run est immuable : une référence d'entrée incomplète ne doit jamais y être écrite
    // (le DTO arrive non validé par le canal IPC).
    const entry = dto.campaignEntry
    if (entry && !(isNonEmptyString(entry.campaignId) && isNonEmptyString(entry.entryId))) {
      throw new Error(`Invalid campaign entry for a run of ${testCaseId}`)
    }

    const runId = await this.nextRunId(targetRepo, testCaseId)
    // GH36 — un résultat importé porte la date d'exécution saisie par le testeur.
    const now = dto.executedAt ?? new Date().toISOString()

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
      // GH73 — run rattaché à l'entrée de campagne exécutée (deux clés seulement, rien d'autre du DTO).
      ...(entry && { campaignEntry: { campaignId: entry.campaignId, entryId: entry.entryId } }),
      // T179 — instance générée pour une exigence : le run ne couvre qu'elle.
      ...(dto.requirementId && { requirementId: dto.requirementId }),
      result,
      executedAt: now,
      executedBy: dto.executedBy || 'TODO:current-user',
      duration: 0,
      equipmentUsed: dto.equipmentUsed ?? [],
      stepResults: stepResults.map((s) => ({ ...s, executedAt: now })),
      notes: dto.notes ?? '',
      ...(dto.origin && { origin: dto.origin }),
    }

    await this.git.writeYaml(targetRepo, `test-runs/${testCaseId}/${runId}.yaml`, run)
    this.testsIndex.upsertRun(repoPath, run)
    return run
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** See RequirementsService.appendToTree — same reasoning, same tree format (T138). */
  private async appendToTree(repoPath: string, objectTypeRef: string, objectId: string, title: string): Promise<void> {
    if (!this.tree) return
    try {
      const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
      const location = schema ? resolveObjectTypeLocation(schema, objectTypeRef) : null
      if (!location || location === 'unresolvable') return

      const { nodeName, typeDef } = location
      const current = await this.tree.get(repoPath, nodeName, typeDef.name)
      const node = { id: randomUUID(), kind: 'item' as const, name: title, objectId, children: [] }
      await this.tree.save(repoPath, { nodeId: nodeName, typeId: typeDef.name, root: [...current.root, node] })
    } catch (err) {
      console.error(`Erreur insertion arbre pour ${objectId}:`, err)
    }
  }

  /** Prefix resolved from `repoPath`'s schema, number allocated in `targetRepo` — see
   *  RequirementsService.nextId (GH20). */
  private async nextTestId(repoPath: string, targetRepo: string, objectTypeRef: string): Promise<string> {
    // Scoped by node via the shared lookup — see requirements.service.ts's nextId() for why
    // a flat search across every node's objectTypes is wrong (T113: sibling SystemNodes can
    // legitimately reuse the same type name with different prefixes).
    const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    const prefix = (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined)
      ?? typeName.slice(0, 6).toUpperCase()

    return nextCounterId(this.git, targetRepo, prefix, 'tests', targetRepo === repoPath ? [] : [repoPath])
  }

  private async nextRunId(repoPath: string, testCaseId: string): Promise<string> {
    const existingRuns = await this.git.listFiles(repoPath, `test-runs/${testCaseId}`)
    return `${testCaseId}-run-${String(existingRuns.length + 1).padStart(4, '0')}`
  }
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== ''
