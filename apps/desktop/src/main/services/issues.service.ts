import { initialStatus, isUnknownStatus, renameFieldKeys } from '@polenta/types'
import type { FieldRename, FieldRenameResult, Issue, ObjectTypeDefinition, ProjectSchema, WithTransitionWarnings } from '@polenta/types'
import type { CreateIssueDto, UpdateIssueDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { SchemaService } from './schema.service'
import type { HistoryService } from './history.service'
import { omitAuditFields } from './audit-fields.util'
import { applyFieldsWrite, readOwnedTypeDef } from './field-write.util'
import type { TransitionGuardService } from './transition-guard.service'
import { nextCounterId } from './id-counter.util'
import { mergeFields } from './field-merge.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { withKeyLock } from './serialize-writes.util'

const ISSUES_DIR = 'issues'

/**
 * GH244 — issues : index par repo et écritures (`issues/<ID>.yaml`). Pas de verrou d'approbation :
 * ni contrôle de contenu, ni incrément de `version`, quel que soit le statut.
 */
export class IssuesService {
  private readonly index = new Map<string, Map<string, Issue>>()

  constructor(
    private readonly git: GitService,
    private readonly schema: SchemaService,
    private readonly history?: HistoryService,
    /** Repo en lecture seule (composant épinglé) : écritures refusées. */
    private readonly isReadonly?: (repoPath: string, workspaceDir?: string) => Promise<boolean>,
  ) {}

  private transitionGuard?: Pick<TransitionGuardService, 'assert'>

  /** GH206 — contraintes de transition (injectées après construction : le garde lit la couverture). */
  setTransitionGuard(guard: Pick<TransitionGuardService, 'assert'>): void {
    this.transitionGuard = guard
  }

  async findAll(repoPath: string): Promise<Issue[]> {
    const idx = await this.getOrBuild(repoPath)
    return [...idx.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  async findOne(repoPath: string, id: string): Promise<Issue> {
    const issue = (await this.getOrBuild(repoPath)).get(id)
    if (!issue) throw new Error(`Issue ${id} not found`)
    return issue
  }

  async create(repoPath: string, dto: CreateIssueDto, workspaceDir?: string): Promise<WithTransitionWarnings<Issue>> {
    const typeDef = await this.readTypeDef(repoPath, dto.objectTypeRef)
    if (!typeDef || typeDef.category !== 'issue') throw new Error(`Type d'issue inconnu : ${dto.objectTypeRef}`)
    if (dto.status && isUnknownStatus(typeDef, dto.status)) {
      throw new Error(`Statut inconnu pour le type ${dto.objectTypeRef} : "${dto.status}"`)
    }
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    await this.assertWritable(targetRepo, workspaceDir)
    const prefix = typeDef.prefix ?? (dto.objectTypeRef.split('::').pop() ?? dto.objectTypeRef).slice(0, 6).toUpperCase()
    return withKeyLock(`${targetRepo}::${ISSUES_DIR}/${prefix}`, async () => {
      const id = await nextCounterId(this.git, targetRepo, prefix, ISSUES_DIR, targetRepo === repoPath ? [] : [repoPath])
      if (await this.git.fileExists(targetRepo, `${ISSUES_DIR}/${id}.yaml`)) throw new Error(`Issue ${id} already exists`)
      return this.persist(repoPath, targetRepo, null, {
        id, projectId: '', branchId: '', objectTypeRef: dto.objectTypeRef, title: dto.title,
        status: dto.status ?? initialStatus(typeDef), version: 1, fields: dto.fields ?? {},
        ...(dto.origin && { origin: dto.origin }),
        createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
      }, undefined, workspaceDir)
    })
  }

  async update(
    repoPath: string, id: string, dto: UpdateIssueDto, workspaceDir?: string,
    /** Une clé de `fields` à `null` retire le champ (GH150). */
    opts: { removeNullFields?: boolean } = {},
  ): Promise<WithTransitionWarnings<Issue>> {
    return withKeyLock(`${repoPath}::${ISSUES_DIR}/${id}`, async () => {
      const existing = await this.findOne(repoPath, id)
      const typeDef = await this.readTypeDef(repoPath, existing.objectTypeRef)
      if (dto.status && typeDef && isUnknownStatus(typeDef, dto.status)) {
        throw new Error(`Statut inconnu pour le type ${existing.objectTypeRef} : "${dto.status}"`)
      }
      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      await this.assertWritable(targetRepo, workspaceDir)
      return this.persist(repoPath, targetRepo, existing, {
        ...existing,
        ...(dto.title && { title: dto.title }),
        ...(dto.status && { status: dto.status }),
        fields: opts.removeNullFields ? mergeFields(existing.fields, dto.fields) : { ...existing.fields, ...(dto.fields ?? {}) },
      }, dto.modificationComment, workspaceDir)
    })
  }

  /** Exécution à l'origine de l'issue (« Lier à une issue existante », GH244 §5). */
  async addRun(repoPath: string, id: string, runId: string, workspaceDir?: string): Promise<Issue> {
    return withKeyLock(`${repoPath}::${ISSUES_DIR}/${id}`, async () => {
      const existing = await this.findOne(repoPath, id)
      if (existing.origin?.runs?.includes(runId)) return existing
      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      await this.assertWritable(targetRepo, workspaceDir)
      return this.persist(repoPath, targetRepo, existing, {
        ...existing,
        origin: { ...existing.origin, runs: [...(existing.origin?.runs ?? []), runId] },
      })
    })
  }

  /** GH204 — décision de validation à l'origine de l'issue (« Lier à une issue existante »). */
  async addDecision(repoPath: string, id: string, decisionRef: string, workspaceDir?: string): Promise<Issue> {
    return withKeyLock(`${repoPath}::${ISSUES_DIR}/${id}`, async () => {
      const existing = await this.findOne(repoPath, id)
      if (existing.origin?.decisions?.includes(decisionRef)) return existing
      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      await this.assertWritable(targetRepo, workspaceDir)
      return this.persist(repoPath, targetRepo, existing, {
        ...existing,
        origin: { ...existing.origin, decisions: [...(existing.origin?.decisions ?? []), decisionRef] },
      })
    })
  }

  /** GH77 — renommage de champs dans l'éditeur de schéma : valeur et historique. */
  renameFieldKeys(repoPath: string, objectTypeRef: string, renames: FieldRename[], result: FieldRenameResult): Promise<void> {
    return this.rewriteObjects(repoPath, objectTypeRef, o => renameFieldKeys(o, renames), result)
  }

  /** Réécriture brute des issues d'un type (renommage de type ou de valeur) : ni historique, ni `version`. */
  async rewriteObjects(
    repoPath: string, objectTypeRef: string, transform: (obj: Issue) => Issue | 'conflict' | null, result: FieldRenameResult,
  ): Promise<void> {
    for (const { id, objectTypeRef: ref } of await this.findAll(repoPath)) {
      if (ref !== objectTypeRef) continue
      try {
        await withKeyLock(`${repoPath}::${ISSUES_DIR}/${id}`, async () => {
          const next = transform(await this.findOne(repoPath, id))
          if (next === 'conflict') result.skipped.push({ id, reason: 'target_exists' })
          if (!next || next === 'conflict') return
          await this.git.writeYaml(repoPath, `${ISSUES_DIR}/${id}.yaml`, omitAuditFields(next))
          this.upsert(repoPath, next)
          result.migrated.push(id)
        })
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  invalidate(repoPath: string): void {
    this.index.delete(repoPath)
  }

  invalidateFile(repoPath: string, filePath: string): void {
    if (filePath.split(/[\\/]/)[0] === ISSUES_DIR) this.invalidate(repoPath)
  }

  /** Seule écriture d'un fichier d'issue : historique des champs suivis, sans les champs d'audit. */
  private async persist(
    repoPath: string, targetRepo: string, before: Issue | null, next: Issue, comment?: string, workspaceDir?: string,
  ): Promise<WithTransitionWarnings<Issue>> {
    const after = await applyFieldsWrite(this.git, repoPath, before, next, targetRepo)
    // GH206 — contraintes de transition, sur l'état résultant et le type du propriétaire.
    const transitionWarnings = this.transitionGuard
      ? await this.transitionGuard.assert(repoPath, await readOwnedTypeDef(this.git, repoPath, after.objectTypeRef, targetRepo), before, after, workspaceDir)
      : []
    const stamped = this.history
      ? await this.history.stamp(repoPath, after.objectTypeRef, before, after, before ?? { updatedAt: null, updatedBy: null }, targetRepo, comment)
      : after
    await this.git.writeYaml(targetRepo, `${ISSUES_DIR}/${stamped.id}.yaml`, omitAuditFields(stamped))
    this.upsert(repoPath, stamped)
    // Notifications rendues à l'appelant, jamais écrites ni indexées.
    return transitionWarnings.length > 0 ? { ...stamped, transitionWarnings } : stamped
  }

  private upsert(repoPath: string, issue: Issue): void {
    this.index.get(repoPath)?.set(issue.id, issue)
  }

  private async assertWritable(repoPath: string, workspaceDir?: string): Promise<void> {
    if (await this.isReadonly?.(repoPath, workspaceDir)) throw new Error(`READONLY_REPO: composant en lecture seule (${repoPath})`)
  }

  private async readTypeDef(repoPath: string, objectTypeRef: string): Promise<ObjectTypeDefinition | null> {
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    return resolved && resolved !== 'unresolvable' ? resolved : null
  }

  private async getOrBuild(repoPath: string): Promise<Map<string, Issue>> {
    const cached = this.index.get(repoPath)
    if (cached) return cached
    const files = (await this.git.listFiles(repoPath, ISSUES_DIR).catch(() => [])).filter(f => f.endsWith('.yaml'))
    // Dérivés du git log du fichier, jamais lus dans le YAML (T112).
    const historyMap = await this.git.fileHistoryMap(repoPath, ISSUES_DIR).catch(() => new Map())
    const built = new Map<string, Issue>()
    await Promise.all(files.map(async (file) => {
      // Un fichier en cours d'édition peut être invalide : ignoré plutôt que de vider la liste.
      const issue = await this.git.readYaml<Issue>(repoPath, file).catch(() => null)
      if (!issue?.id) return
      const audit = historyMap.get(file)
      built.set(issue.id, {
        ...issue,
        fields: issue.fields ?? {},
        createdAt: audit?.createdAt ?? null,
        createdBy: audit?.createdBy ?? null,
        updatedAt: audit?.updatedAt ?? null,
        updatedBy: audit?.updatedBy ?? null,
      })
    }))
    this.index.set(repoPath, built)
    return built
  }
}
