import type {
  CoverageStatus, ObjectTypeDefinition, ProjectSchema, ProductVersion, Validation, ValidationEntry, ValidationImpact,
  ValidationProblem, ValidationRow, VersionAnalysis, VersionState,
} from '@polenta/types'
import { isFieldRequiredNow, isFieldValueFilled, missingEntryFields, objectFieldReader, pendingDecision } from '@polenta/types'
import { findObjectTypeDef } from './schema-lookup.util'
import type { ElementState } from './version-tracking.service'
import { contentHash } from './version-tracking.service'

// GH204 — règles de la validation, sans lecture : le service lit, ces fonctions décident.

const NO_IMPACT = 'pas_d_impact_reel'

export interface ValidationRequirement {
  state: ElementState
  fields: Record<string, unknown>
}

function isTerminal(schema: ProjectSchema | null, state: ElementState): boolean {
  const def = schema ? findObjectTypeDef(schema, state.objectTypeRef) : null
  return !!def && def !== 'unresolvable' && !!def.statuses?.find(s => s.name === state.status)?.isTerminal
}

/** Exigences du périmètre : hors statut terminal (spec §3). */
export function inPerimeter(schema: ProjectSchema | null, requirements: ValidationRequirement[]): ValidationRequirement[] {
  return requirements.filter(r => !isTerminal(schema, r.state))
}

/** Changée (dans `changes`), ou impactée (ligne atteinte de l'analyse, hors « pas d'impact réel »). */
export function impactOf(version: Pick<ProductVersion, 'changes'>, analysis: VersionAnalysis | null): (id: string) => ValidationImpact | null {
  const changed = new Set((version.changes ?? []).map(c => c.id))
  const rows = new Map((analysis?.rows ?? []).map(r => [r.id, r]))
  return id => {
    const row = rows.get(id)
    if (changed.has(id)) return { kind: 'changed', sources: row?.sources ?? [] }
    if (row && row.reached && row.status !== NO_IMPACT) return { kind: 'impacted', sources: row.sources }
    return null
  }
}

/** « À revoir » : contenu différent de celui de la décision, ou décision reprise devenue impactée. */
export function reviewOf(entry: ValidationEntry | null, hash: string, impact: ValidationImpact | null): ValidationRow['review'] {
  if (!entry) return null
  if (entry.contentHash !== hash) return 'content'
  if (entry.carriedFrom && impact) return 'impact'
  return null
}

export function buildRows(input: {
  schema: ProjectSchema | null
  typeDef: ObjectTypeDefinition
  validation: Pick<Validation, 'entries'>
  requirements: ValidationRequirement[]
  impact: (id: string) => ValidationImpact | null
  coverage: Map<string, { status: CoverageStatus; tests: ValidationRow['tests'] }>
  design: Map<string, { id: string; title: string }>
}): ValidationRow[] {
  const pending = pendingDecision(input.typeDef)?.name ?? ''
  const entries = new Map(input.validation.entries.map(e => [e.requirementId, e]))
  return inPerimeter(input.schema, input.requirements)
    .map(({ state, fields }): ValidationRow => {
      const entry = entries.get(state.id) ?? null
      const impact = input.impact(state.id)
      return {
        requirementId: state.id, title: state.title, objectTypeRef: state.objectTypeRef, status: state.status, fields,
        designVersion: input.design.get(state.id) ?? null,
        coverageStatus: input.coverage.get(state.id)?.status ?? 'not_covered',
        tests: input.coverage.get(state.id)?.tests ?? [],
        impact, decision: entry?.decision ?? pending, entry,
        review: reviewOf(entry, contentHash(state), impact),
      }
    })
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId, undefined, { numeric: true }))
}

/** Reprise (spec §5) : exigence ni changée, ni impactée, de contenu identique à la décision signée. */
export function carryOver(
  signed: Pick<Validation, 'id' | 'entries'> | null,
  requirements: ValidationRequirement[],
  impact: (id: string) => ValidationImpact | null,
): ValidationEntry[] {
  if (!signed) return []
  const previous = new Map(signed.entries.map(e => [e.requirementId, e]))
  const out: ValidationEntry[] = []
  for (const { state } of requirements) {
    const entry = previous.get(state.id)
    if (!entry || impact(state.id) || entry.contentHash !== contentHash(state)) continue
    out.push({ ...entry, carriedFrom: signed.id })
  }
  return out
}

/** Motifs de refus de signature (spec §4), tous listés. */
export function signatureProblems(input: {
  typeDef: ObjectTypeDefinition
  validation: Pick<Validation, 'status' | 'fields'>
  versionState: VersionState
  rows: ValidationRow[]
}): ValidationProblem[] {
  const { typeDef, validation, versionState, rows } = input
  const problems: ValidationProblem[] = []
  const add = (code: ValidationProblem['code'], ids: string[]) => { if (ids.length > 0) problems.push({ code, ids }) }
  if (versionState !== 'released') problems.push({ code: 'VERSION_NOT_RELEASED', ids: [] })
  const pending = pendingDecision(typeDef)?.name
  add('DECISION_PENDING', rows.filter(r => r.decision === pending).map(r => r.requirementId))
  add('DECISION_PROPOSED', rows.filter(r => r.entry?.proposed).map(r => r.requirementId))
  add('DECISION_TO_REVIEW', rows.filter(r => r.review && !r.entry?.proposed).map(r => r.requirementId))
  // `requiredWhen` sur le statut : évalué pour le statut signé, celui qui sera écrit.
  const approval = typeDef.statuses?.find(s => s.isApproval)?.name
  const read = objectFieldReader(typeDef, { ...validation, ...(approval && { status: approval }) })
  const missing = typeDef.fields.filter(f => isFieldRequiredNow(f, read) && !isFieldValueFilled(validation.fields?.[f.name])).map(f => f.name)
  for (const r of rows) {
    if (!r.entry) continue
    for (const f of missingEntryFields(typeDef.entryFields, r.entry)) missing.push(`${r.requirementId}/${f}`)
  }
  add('FIELD_MISSING', missing)
  return problems
}
