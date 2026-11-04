import * as path from 'path'
import * as yaml from 'js-yaml'
import type {
  FieldRename, FieldRenameResult, ObjectTypeDefinition, ProductVersion, ProjectSchema, Validation, ValidationComponentStatus,
  ValidationEntry, ValidationErrorCode, ValidationPage, ValidationRow, ValidationVersionItem,
} from '@polenta/types'
import { flattenSystemNodes, initialStatus, pendingDecision, renameFieldKeys, validationState, versionState } from '@polenta/types'
import type { CreateValidationDto, UpdateValidationDto, ValidationDecisionDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { HistoryService } from './history.service'
import type { SchemaService } from './schema.service'
import type { SyncService } from './sync.service'
import type { TraceabilityService } from './traceability.service'
import type { VersionsService } from './versions.service'
import { applyFieldsWrite } from './field-write.util'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'
import { repoKey } from './schema-refs.util'
import { buildRows, carryOver, impactOf, inPerimeter, signatureProblems } from './validation-rows.util'
import type { ValidationRequirement } from './validation-rows.util'
import { contentHash } from './version-tracking.service'

/** Erreur métier : le message commence par le code (`VALIDATION_LOCKED: …`), traduit par le renderer. */
export class ValidationError extends Error {
  constructor(readonly code: ValidationErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'ValidationError'
  }
}

interface ValidationType { typeDef: ObjectTypeDefinition; ref: string }

export const VALIDATIONS_DIR = 'validations'
const fileOf = (id: string) => `${VALIDATIONS_DIR}/${id}.yaml`
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true })

/**
 * GH204 — validations d'une version : décisions par exigence, reprise, signature. Une validation est
 * stockée dans le repo de son composant ; une exigence sans entrée est en attente, si bien qu'aucune
 * lecture n'écrit et qu'une validation signée contient toutes ses décisions.
 */
export class ValidationsService {
  constructor(
    private readonly git: GitService,
    private readonly sync: Pick<SyncService, 'commitSingleFile'>,
    private readonly schema: Pick<SchemaService, 'get'>,
    private readonly versions: Pick<VersionsService, 'get' | 'list' | 'versionType' | 'analysis' | 'isReadonly' | 'requirementsOf' | 'schemaOf' | 'designVersionsFor' | 'componentVersions'>,
    private readonly traceability: Pick<TraceabilityService, 'getMatrix'>,
    private readonly history: Pick<HistoryService, 'stamp' | 'currentActor'>,
  ) {}

  private writeQueues = new Map<string, Promise<unknown>>()

  /** Sérialise les écritures d'un repo : contrôle puis écriture, sans écrasement entre décisions. */
  private enqueue<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
    const key = repoKey(repoPath)
    const prev = this.writeQueues.get(key) ?? Promise.resolve()
    const run = prev.then(task, task)
    this.writeQueues.set(key, run.then(() => undefined, () => undefined))
    return run
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  /** Type validation du repo (nœud `root`), null si le repo n'en déclare pas. */
  async validationType(repoPath: string): Promise<ValidationType | null> {
    const schema = await this.schema.get(repoPath).catch(() => null as ProjectSchema | null)
    const typeDef = schema?.nodes?.find(n => n.name === 'root')?.objectTypes?.find(t => t.category === 'validation')
    return typeDef ? { typeDef, ref: `root::${typeDef.name}` } : null
  }

  async list(repoPath: string): Promise<Validation[]> {
    const files = (await this.git.listFiles(repoPath, VALIDATIONS_DIR).catch(() => []))
      .filter(f => f.endsWith('.yaml') && f.split('/').length === 2)
    const out: Validation[] = []
    for (const file of files) {
      const v = await this.git.readYaml<Validation>(repoPath, file).catch(() => null)
      if (v?.id) out.push(normalize(v))
    }
    return out.sort(byId)
  }

  async get(repoPath: string, id: string): Promise<Validation> {
    const v = await this.git.readYaml<Validation>(repoPath, fileOf(id)).catch(() => null)
    if (!v?.id) throw new ValidationError('VALIDATION_NOT_FOUND', id)
    return normalize(v)
  }

  /** Versions du composant, de la plus récente à la plus ancienne, et leur validation non annulée. */
  async versionItems(repoPath: string): Promise<ValidationVersionItem[]> {
    const vt = await this.validationType(repoPath)
    const versionDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
    const validations = await this.list(repoPath)
    return (await this.versions.list(repoPath)).reverse().map((v): ValidationVersionItem => {
      const found = validations.find(x => x.versionId === v.id && validationState(vt?.typeDef, x.status) !== 'cancelled')
      return {
        version: { id: v.id, title: v.title, state: versionState(versionDef, v.status) },
        validation: found ? { id: found.id, title: found.title, status: found.status, state: validationState(vt?.typeDef, found.status) } : null,
      }
    })
  }

  async page(repoPath: string, id: string, workspaceDir?: string): Promise<ValidationPage> {
    const validation = await this.get(repoPath, id)
    const vt = await this.requireType(repoPath)
    const version = await this.requireVersion(repoPath, validation.versionId)
    const versionDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
    const vState = versionState(versionDef, version.status)
    const rows = await this.rows(repoPath, vt.typeDef, validation, version, workspaceDir)
    const pending = pendingDecision(vt.typeDef)?.name
    const statusEntries = validation.history?.status ?? []
    const signedEntry = [...statusEntries].reverse().find(e => e.value === validation.status)
    const state = validationState(vt.typeDef, validation.status)
    return {
      validation, typeDef: vt.typeDef, state,
      version: { id: version.id, title: version.title, state: vState },
      rows,
      pendingCount: rows.filter(r => r.decision === pending).length,
      problems: signatureProblems({ typeDef: vt.typeDef, validation, versionState: vState, rows }),
      readonly: await this.versions.isReadonly(repoPath, workspaceDir),
      signed: state === 'signed' && signedEntry ? { at: signedEntry.at, by: signedEntry.by ?? null } : null,
      components: await this.componentStatuses(repoPath, version, workspaceDir),
      ...(await this.requirementDisplay(repoPath)),
    }
  }

  /** Champs et libellés de statut des types d'exigence du repo (colonnes de la grille). */
  private async requirementDisplay(repoPath: string): Promise<Pick<ValidationPage, 'requirementFields' | 'requirementStatusLabels'>> {
    const schema = await this.schema.get(repoPath).catch(() => null)
    const types = flattenSystemNodes(schema?.nodes ?? []).flatMap(({ node }) => node.objectTypes ?? []).filter(t => t.category === 'requirement')
    const fields = new Map(types.flatMap(t => t.fields).map(f => [f.name, f]))
    const requirementStatusLabels = Object.fromEntries(types.flatMap(t => t.statuses ?? []).map(s => [s.name, s.label || s.name]))
    return { requirementFields: [...fields.values()], requirementStatusLabels }
  }

  private async rows(repoPath: string, typeDef: ObjectTypeDefinition, validation: Validation, version: ProductVersion, workspaceDir?: string): Promise<ValidationRow[]> {
    const schema = await this.versions.schemaOf(repoPath, version)
    const requirements = await this.versions.requirementsOf(repoPath, version)
    // Sans analyse, aucune exigence ne paraîtrait impactée : l'erreur remonte plutôt que d'ouvrir la signature.
    const analysis = await this.versions.analysis(repoPath, version.id, workspaceDir)
    // Sans matrice, toutes les exigences paraîtraient non couvertes : l'erreur remonte (GH266).
    const matrix = await this.traceability.getMatrix(repoPath, {}, workspaceDir)
    const titles = new Map(matrix.testCases.map(t => [t.id, t.title]))
    const localTests = new Set((await this.git.listFiles(repoPath, 'tests').catch(() => [])).map(f => f.split('/').pop()!.replace(/\.yaml$/, '')))
    const coverage = new Map(matrix.requirements.map(r => [r.requirement.id, {
      status: r.coverageStatus,
      tests: r.cells.map(c => ({ id: c.testCaseId, title: titles.get(c.testCaseId) ?? '', local: localTests.has(c.testCaseId) })),
    }]))
    return buildRows({
      schema, typeDef, validation, requirements, coverage,
      impact: impactOf(version, analysis),
      design: await this.versions.designVersionsFor(repoPath, requirements.map(r => r.state)),
      cancelled: validationState(typeDef, validation.status) === 'open'
        ? new Set((await this.list(repoPath)).filter(v => validationState(typeDef, v.status) === 'cancelled').map(v => v.id))
        : new Set(),
    })
  }

  private async componentStatuses(repoPath: string, version: ProductVersion, workspaceDir?: string): Promise<ValidationComponentStatus[]> {
    const deps = await this.versions.componentVersions(repoPath, version, workspaceDir)
    return Promise.all(deps.map(async (dep): Promise<ValidationComponentStatus> => {
      const depVersion = dep.versionId ? await this.versions.get(dep.repoPath, dep.versionId).catch(() => null) : null
      const depType = await this.validationType(dep.repoPath)
      const found = depVersion
        ? (await this.list(dep.repoPath)).find(v => v.versionId === depVersion.id && validationState(depType?.typeDef, v.status) !== 'cancelled')
        : undefined
      return {
        name: dep.name, label: dep.label, repoPath: dep.repoPath,
        version: depVersion ? { id: depVersion.id, title: depVersion.title } : null,
        validation: found ? { id: found.id, state: validationState(depType?.typeDef, found.status) } : null,
      }
    }))
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  async create(repoPath: string, dto: CreateValidationDto, workspaceDir?: string): Promise<Validation> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.requireType(repoPath)
      if (!vt.typeDef.prefix) throw new ValidationError('NO_VALIDATION_TYPE', `${vt.ref} : préfixe manquant`)
      const title = (dto.title ?? '').trim()
      if (!title) throw new ValidationError('TITLE_EMPTY', dto.versionId)
      const version = await this.requireVersion(repoPath, dto.versionId)
      const versionDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
      if (versionState(versionDef, version.status) === 'abandoned') throw new ValidationError('VERSION_ABANDONED', version.id)
      const all = await this.list(repoPath)
      const existing = all.find(v => v.versionId === version.id && validationState(vt.typeDef, v.status) !== 'cancelled')
      if (existing) throw new ValidationError('VALIDATION_EXISTS', existing.id)
      const id = await nextCounterId(this.git, repoPath, vt.typeDef.prefix, VALIDATIONS_DIR)
      await assertNewObjectFile(this.git, repoPath, fileOf(id), id)
      const created: Validation = {
        id, projectId: '', branchId: '', objectTypeRef: vt.ref, title, status: initialStatus(vt.typeDef), versionId: version.id,
        fields: dto.fields ?? {},
        entries: await this.carriedEntries(repoPath, vt.typeDef, all, version, workspaceDir),
      }
      return this.persist(repoPath, null, created)
    })
  }

  /** Reprise des décisions de la validation signée de `basedOn` (spec §5). */
  private async carriedEntries(repoPath: string, typeDef: ObjectTypeDefinition, all: Validation[], version: ProductVersion, workspaceDir?: string): Promise<ValidationEntry[]> {
    const signed = version.basedOn ? all.find(v => v.versionId === version.basedOn && validationState(typeDef, v.status) === 'signed') ?? null : null
    if (!signed) return []
    const schema = await this.versions.schemaOf(repoPath, version)
    const requirements = inPerimeter(schema, await this.versions.requirementsOf(repoPath, version))
    const analysis = await this.versions.analysis(repoPath, version.id, workspaceDir)
    return carryOver(signed, requirements, impactOf(version, analysis))
  }

  async update(repoPath: string, id: string, dto: UpdateValidationDto, workspaceDir?: string): Promise<Validation> {
    return this.mutate(repoPath, id, workspaceDir, async ({ validation }) => {
      const title = dto.title?.trim()
      if (dto.title !== undefined && !title) throw new ValidationError('TITLE_EMPTY', id)
      return { ...validation, ...(title && { title }), fields: { ...validation.fields, ...(dto.fields ?? {}) } }
    })
  }

  /** Prend ou change une décision (confirme aussi une proposition) ; la valeur `isPending` retire l'entrée. */
  async decide(repoPath: string, id: string, dto: ValidationDecisionDto, workspaceDir?: string): Promise<Validation> {
    return this.mutate(repoPath, id, workspaceDir, async ({ validation, typeDef, requirement }) => {
      assertDecision(typeDef, dto.decision)
      const state = (await requirement(dto.requirementId)).state
      if (dto.decision === pendingDecision(typeDef)?.name) return withoutEntry(validation, dto.requirementId)
      const details = {
        ...(dto.comment?.trim() && { comment: dto.comment.trim() }),
        ...(dto.fields && Object.keys(dto.fields).length > 0 && { fields: dto.fields }),
      }
      // Même décision, commentaire ou champs complétés : ce n'est pas une nouvelle décision. Une
      // proposition reste à confirmer, et un signal « à revoir » reste levé jusqu'à la confirmation.
      const existing = validation.entries.find(e => e.requirementId === dto.requirementId)
      if (existing && existing.decision === dto.decision) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { comment, fields, ...kept } = existing
        return withEntry(validation, { ...kept, ...details })
      }
      const actor = await this.history.currentActor(repoPath)
      return withEntry(validation, {
        requirementId: dto.requirementId, decision: dto.decision, ...details,
        contentHash: contentHash(state), decidedBy: actor.by, decidedAt: new Date().toISOString(),
      })
    })
  }

  /** Confirme une décision « à revoir » ou proposée, telle quelle. */
  async confirm(repoPath: string, id: string, requirementId: string, workspaceDir?: string): Promise<Validation> {
    return this.mutate(repoPath, id, workspaceDir, async ({ validation, requirement }) => {
      const entry = validation.entries.find(e => e.requirementId === requirementId)
      if (!entry) throw new ValidationError('NO_DECISION', requirementId)
      const state = (await requirement(requirementId)).state
      const actor = await this.history.currentActor(repoPath)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { carriedFrom, proposed, proposedBy, proposedAt, ...rest } = entry
      return withEntry(validation, { ...rest, contentHash: contentHash(state), decidedBy: actor.by, decidedAt: new Date().toISOString() })
    })
  }

  /** Rejette une décision proposée : l'exigence repasse en attente. */
  async reject(repoPath: string, id: string, requirementId: string, workspaceDir?: string): Promise<Validation> {
    return this.mutate(repoPath, id, workspaceDir, async ({ validation }) => {
      if (!validation.entries.find(e => e.requirementId === requirementId)?.proposed) throw new ValidationError('NOT_PROPOSED', requirementId)
      return withoutEntry(validation, requirementId)
    })
  }

  /** Décision proposée (MCP) : jamais sur une décision confirmée ; un humain confirme ou rejette. */
  async propose(repoPath: string, id: string, dto: ValidationDecisionDto, workspaceDir?: string): Promise<Validation> {
    return this.mutate(repoPath, id, workspaceDir, async ({ validation, typeDef, requirement }) => {
      assertDecision(typeDef, dto.decision)
      if (dto.decision === pendingDecision(typeDef)?.name) throw new ValidationError('DECISION_UNKNOWN', dto.decision)
      const existing = validation.entries.find(e => e.requirementId === dto.requirementId)
      if (existing && !existing.proposed) throw new ValidationError('DECISION_CONFIRMED', dto.requirementId)
      const state = (await requirement(dto.requirementId)).state
      const actor = await this.history.currentActor(repoPath)
      return withEntry(validation, {
        requirementId: dto.requirementId, decision: dto.decision,
        ...(dto.comment?.trim() && { comment: dto.comment.trim() }),
        ...(dto.fields && Object.keys(dto.fields).length > 0 && { fields: dto.fields }),
        contentHash: contentHash(state), proposed: true, proposedBy: actor.by, proposedAt: new Date().toISOString(),
      })
    })
  }

  /** Signature : contrôles, entrées limitées au périmètre, commit du seul fichier (ni tag ni baseline). */
  async sign(repoPath: string, id: string, workspaceDir?: string): Promise<Validation> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.requireType(repoPath)
      const validation = await this.get(repoPath, id)
      if (validationState(vt.typeDef, validation.status) !== 'open') throw new ValidationError('VALIDATION_LOCKED', id)
      // Deux branches fusionnées peuvent porter chacune une validation de la même version (GH266).
      const twin = (await this.list(repoPath)).find(v => v.id !== id && v.versionId === validation.versionId && validationState(vt.typeDef, v.status) !== 'cancelled')
      if (twin) throw new ValidationError('VALIDATION_EXISTS', twin.id)
      const version = await this.requireVersion(repoPath, validation.versionId)
      const versionDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
      const rows = await this.rows(repoPath, vt.typeDef, validation, version, workspaceDir)
      const problems = signatureProblems({ typeDef: vt.typeDef, validation, versionState: versionState(versionDef, version.status), rows })
      if (problems.length > 0) {
        throw new ValidationError('SIGNATURE_REFUSED', problems.map(p => `${p.code} ${p.ids.join(', ')}`.trim()).join(' ; '))
      }
      const perimeter = new Set(rows.map(r => r.requirementId))
      const approval = vt.typeDef.statuses!.find(s => s.isApproval)!.name
      const signed = await this.stamp(repoPath, validation, {
        ...validation, status: approval, entries: validation.entries.filter(e => perimeter.has(e.requirementId)),
      })
      const content = yaml.dump(signed, { lineWidth: 120 })
      await this.sync.commitSingleFile(repoPath, fileOf(id), content, `[validation] ${id} ${validation.title} signée`)
      await this.git.writeText(repoPath, fileOf(id), content)
      return signed
    })
  }

  /** Annulation, depuis l'état en cours ou signé : l'historique du statut en garde la trace. */
  async cancel(repoPath: string, id: string, workspaceDir?: string): Promise<Validation> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.requireType(repoPath)
      const validation = await this.get(repoPath, id)
      if (validationState(vt.typeDef, validation.status) === 'cancelled') throw new ValidationError('VALIDATION_LOCKED', id)
      return this.persist(repoPath, validation, { ...validation, status: vt.typeDef.statuses!.find(s => s.isTerminal)!.name })
    })
  }

  /** Validation en cours seulement (pierre tombale GH20). */
  async delete(repoPath: string, id: string, workspaceDir?: string): Promise<void> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.requireType(repoPath)
      const validation = await this.get(repoPath, id)
      if (validationState(vt.typeDef, validation.status) !== 'open') throw new ValidationError('VALIDATION_LOCKED', id)
      await deleteWithTombstone(this.git, repoPath, fileOf(id), id)
    })
  }

  // ── Renommages du schéma ───────────────────────────────────────────────────

  /** GH77 — renommage de champs du type : valeur et historique. */
  renameFieldKeys(repoPath: string, objectTypeRef: string, renames: FieldRename[], result: FieldRenameResult): Promise<void> {
    return this.rewriteObjects(repoPath, objectTypeRef, o => renameFieldKeys(o, renames), result)
  }

  /** Réécriture brute des validations d'un type, signées comprises (renommage, pas une décision). */
  async rewriteObjects(
    repoPath: string, objectTypeRef: string, transform: (obj: Validation) => Validation | 'conflict' | null, result: FieldRenameResult,
  ): Promise<void> {
    await this.enqueue(repoPath, async () => {
      for (const validation of await this.list(repoPath)) {
        if (validation.objectTypeRef !== objectTypeRef) continue
        try {
          const next = transform(validation)
          if (next === 'conflict') result.skipped.push({ id: validation.id, reason: 'target_exists' })
          if (!next || next === 'conflict') continue
          await this.git.writeYaml(repoPath, fileOf(validation.id), next)
          result.migrated.push(validation.id)
        } catch (err) {
          result.failed.push({ id: validation.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    })
  }

  // ── Outils ─────────────────────────────────────────────────────────────────

  /** Écriture d'une validation en cours, version non abandonnée. */
  private mutate(
    repoPath: string, id: string, workspaceDir: string | undefined,
    fn: (ctx: { validation: Validation; typeDef: ObjectTypeDefinition; requirement: (reqId: string) => Promise<ValidationRequirement> }) => Promise<Validation>,
  ): Promise<Validation> {
    return this.enqueue(repoPath, async () => {
      await this.assertWritable(repoPath, workspaceDir)
      const vt = await this.requireType(repoPath)
      const validation = await this.get(repoPath, id)
      if (validationState(vt.typeDef, validation.status) !== 'open') throw new ValidationError('VALIDATION_LOCKED', id)
      const version = await this.requireVersion(repoPath, validation.versionId)
      const versionDef = (await this.versions.versionType(repoPath))?.typeDef ?? null
      if (versionState(versionDef, version.status) === 'abandoned') throw new ValidationError('VERSION_ABANDONED', version.id)
      let perimeter: Map<string, ValidationRequirement> | null = null
      const requirement = async (reqId: string): Promise<ValidationRequirement> => {
        if (!perimeter) {
          const schema = await this.versions.schemaOf(repoPath, version)
          perimeter = new Map(inPerimeter(schema, await this.versions.requirementsOf(repoPath, version)).map(r => [r.state.id, r]))
        }
        const found = perimeter.get(reqId)
        if (!found) throw new ValidationError('NOT_IN_PERIMETER', reqId)
        return found
      }
      return this.persist(repoPath, validation, await fn({ validation, typeDef: vt.typeDef, requirement }))
    })
  }

  private async persist(repoPath: string, before: Validation | null, next: Validation): Promise<Validation> {
    const after = await applyFieldsWrite(this.git, repoPath, before, next)
    const stamped = await this.stamp(repoPath, before, after)
    await this.git.writeYaml(repoPath, fileOf(stamped.id), stamped)
    return stamped
  }

  private stamp(repoPath: string, before: Validation | null, after: Validation): Promise<Validation> {
    return this.history.stamp(repoPath, after.objectTypeRef, before, after, { filePath: fileOf(after.id) })
  }

  private async requireType(repoPath: string): Promise<ValidationType> {
    const vt = await this.validationType(repoPath)
    if (!vt) throw new ValidationError('NO_VALIDATION_TYPE', path.basename(repoPath))
    return vt
  }

  private async requireVersion(repoPath: string, id: string): Promise<ProductVersion> {
    return this.versions.get(repoPath, id).catch(() => { throw new ValidationError('VERSION_NOT_FOUND', id) })
  }

  private async assertWritable(repoPath: string, workspaceDir?: string): Promise<void> {
    if (await this.versions.isReadonly(repoPath, workspaceDir)) throw new ValidationError('READONLY_REPO', path.basename(repoPath))
  }
}

function normalize(v: Validation): Validation {
  return { ...v, fields: v.fields ?? {}, entries: v.entries ?? [] }
}

function assertDecision(typeDef: ObjectTypeDefinition, decision: string): void {
  if (!typeDef.decisions?.some(d => d.name === decision)) throw new ValidationError('DECISION_UNKNOWN', decision)
}

function withoutEntry(validation: Validation, requirementId: string): Validation {
  return { ...validation, entries: validation.entries.filter(e => e.requirementId !== requirementId) }
}

/** Entrées triées par exigence : un ordre stable limite les conflits git. */
function withEntry(validation: Validation, entry: ValidationEntry): Validation {
  return {
    ...validation,
    entries: [...validation.entries.filter(e => e.requirementId !== entry.requirementId), entry]
      .sort((a, b) => a.requirementId.localeCompare(b.requirementId, undefined, { numeric: true })),
  }
}
