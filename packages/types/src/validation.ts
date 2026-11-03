import type { ObjectHistory } from './history'
import type { ObjectTypeDefinition, SchemaField } from './schema'
import { isFieldRequiredNow, isFieldValueFilled } from './required-when'
import type { VersionImpactSource, VersionState } from './product-version'
import type { CoverageStatus } from './traceability'

// GH204 — validation d'une version (specs/GH204.md) : décision de la qualité, exigence par exigence.
// Fichier `validations/<ID>.yaml` du repo du composant. Sa signature, sur une version released, est le
// feu vert ; sur la version produit, le go production série.

/** Valeur de décision du type. `isPending` : en attente, bloque la signature ; `proposesIssue` : propose une issue. */
export interface ValidationDecisionDef {
  name: string
  label?: string
  color?: string
  isPending?: boolean
  proposesIssue?: boolean
}

export interface ValidationEntry {
  requirementId: string
  decision: string
  comment?: string
  /** `entryFields` du type. */
  fields?: Record<string, unknown>
  /** Empreinte du contenu de l'exigence dans la version, au moment de la décision. */
  contentHash: string
  decidedBy?: string
  decidedAt?: string
  /** Validation signée d'où vient la décision (reprise). */
  carriedFrom?: string
  /** Proposée par le MCP : un humain la confirme ou la rejette. */
  proposed?: boolean
  proposedBy?: string
  proposedAt?: string
}

export interface Validation {
  id: string
  projectId?: string
  branchId?: string
  objectTypeRef: string
  title: string
  status: string
  /** Version validée (même repo), non modifiable après création. */
  versionId: string
  fields: Record<string, unknown>
  /** Une exigence absente est en attente. */
  entries: ValidationEntry[]
  history?: ObjectHistory
}

export type ValidationState = 'open' | 'signed' | 'cancelled'

/** Lu des marques du type : `isApproval` → signée, `isTerminal` → annulée, sinon en cours. */
export function validationState(typeDef: Pick<ObjectTypeDefinition, 'statuses'> | null | undefined, status: string): ValidationState {
  const def = typeDef?.statuses?.find(s => s.name === status)
  if (def?.isApproval) return 'signed'
  if (def?.isTerminal) return 'cancelled'
  return 'open'
}

export function pendingDecision(typeDef: Pick<ObjectTypeDefinition, 'decisions'> | null | undefined): ValidationDecisionDef | undefined {
  return typeDef?.decisions?.find(d => d.isPending)
}

/** Raison du refus d'un type validation, `null` s'il est valide. */
export function validationTypeError(typeDef: Pick<ObjectTypeDefinition, 'name' | 'decisions' | 'statuses'>): string | null {
  const decisions = typeDef.decisions ?? []
  const pending = decisions.filter(d => d.isPending).length
  if (pending !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement une décision « en attente » (${pending}).`
  const names = decisions.map(d => d.name)
  if (names.some(n => !n)) return `Le type validation "${typeDef.name}" a une décision sans nom.`
  if (new Set(names).size !== names.length) return `Le type validation "${typeDef.name}" a deux décisions de même nom.`
  const statuses = typeDef.statuses ?? []
  if (statuses.filter(s => s.isApproval).length !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement un statut d'approbation (signée).`
  if (statuses.filter(s => s.isTerminal).length !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement un statut terminal (annulée).`
  return null
}

export type ValidationProblemCode =
  | 'VERSION_NOT_RELEASED' | 'DECISION_PENDING' | 'DECISION_PROPOSED' | 'DECISION_TO_REVIEW' | 'FIELD_MISSING'

/** Motif de refus de signature ; `ids` : exigences ou champs concernés. */
export interface ValidationProblem {
  code: ValidationProblemCode
  ids: string[]
}

export type ValidationErrorCode =
  | 'NO_VALIDATION_TYPE' | 'VALIDATION_NOT_FOUND' | 'VALIDATION_EXISTS' | 'VALIDATION_LOCKED' | 'VERSION_NOT_FOUND'
  | 'VERSION_ABANDONED' | 'READONLY_REPO' | 'DECISION_UNKNOWN' | 'NOT_IN_PERIMETER' | 'SIGNATURE_REFUSED'
  | 'NOT_PROPOSED' | 'DECISION_CONFIRMED' | 'NO_DECISION' | 'TITLE_EMPTY'

export const VALIDATION_ERROR_CODES: readonly ValidationErrorCode[] = [
  'NO_VALIDATION_TYPE', 'VALIDATION_NOT_FOUND', 'VALIDATION_EXISTS', 'VALIDATION_LOCKED', 'VERSION_NOT_FOUND',
  'VERSION_ABANDONED', 'READONLY_REPO', 'DECISION_UNKNOWN', 'NOT_IN_PERIMETER', 'SIGNATURE_REFUSED',
  'NOT_PROPOSED', 'DECISION_CONFIRMED', 'NO_DECISION', 'TITLE_EMPTY',
]

/** Signal d'impact d'une exigence dans la version validée. */
export interface ValidationImpact {
  kind: 'changed' | 'impacted'
  sources: VersionImpactSource[]
}

export interface ValidationRow {
  requirementId: string
  title: string
  objectTypeRef: string
  /** Statut de rédaction, lu dans l'état de la version. */
  status: string
  fields: Record<string, unknown>
  /** Statut de design : première version qui inclut l'exigence dans cet état. */
  designVersion: { id: string; title: string } | null
  coverageStatus: CoverageStatus
  impact: ValidationImpact | null
  /** Décision en vigueur : celle de l'entrée, sinon la valeur `isPending`. */
  decision: string
  entry: ValidationEntry | null
  /** À revoir : contenu modifié depuis la décision, ou décision reprise d'une exigence devenue impactée. */
  review: 'content' | 'impact' | null
}

/** Sous-composant de la version validée et état de sa validation (information, non bloquant). */
export interface ValidationComponentStatus {
  name: string
  label: string
  repoPath: string
  version: { id: string; title: string } | null
  validation: { id: string; state: ValidationState } | null
}

export interface ValidationPage {
  validation: Validation
  typeDef: ObjectTypeDefinition
  state: ValidationState
  version: { id: string; title: string; state: VersionState }
  rows: ValidationRow[]
  /** Décisions restant à prendre (`isPending`). */
  pendingCount: number
  /** Motifs de refus de signature, tous listés ; vide : signature possible. */
  problems: ValidationProblem[]
  readonly: boolean
  signed: { at: string; by: string | null } | null
  components: ValidationComponentStatus[]
  /** Champs des types d'exigence du repo (colonnes proposées). */
  requirementFields: SchemaField[]
  /** Libellé de chaque statut de ces types. */
  requirementStatusLabels: Record<string, string>
}

/** Ligne du panneau latéral : une version du composant et sa validation non annulée. */
export interface ValidationVersionItem {
  version: { id: string; title: string; state: VersionState }
  validation: { id: string; title: string; status: string; state: ValidationState } | null
}

/** Champs obligatoires manquants d'une entrée (`required`, `requiredWhen`, décision comprise). */
export function missingEntryFields(entryFields: SchemaField[] | undefined, entry: Pick<ValidationEntry, 'decision' | 'fields'>): string[] {
  const read = (name: string): string[] => {
    if (name === 'decision') return [entry.decision]
    const v = entry.fields?.[name]
    if (v === undefined || v === null) return []
    return Array.isArray(v) ? v.map(String) : [String(v)]
  }
  return (entryFields ?? []).filter(f => isFieldRequiredNow(f, read) && !isFieldValueFilled(entry.fields?.[f.name])).map(f => f.name)
}
