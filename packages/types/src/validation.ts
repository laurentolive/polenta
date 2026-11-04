import type { ObjectHistory } from './history'
import type { ObjectTypeDefinition, SchemaField } from './schema'
import { isFieldRequiredNow, isFieldValueFilled } from './required-when'
import type { VersionImpactSource, VersionState } from './product-version'
import type { CoverageStatus } from './traceability'
import type { TestRunResult } from './test'
import type { TestedConfig, TestedDriftItem } from './tested-config'

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

/** GH267 — dernière exécution d'un test, telle que vue à la signature. */
export interface ValidationSignedRun {
  id: string
  result: TestRunResult
  executedAt: string
  executedBy?: string
  notes?: string
  testedConfig?: TestedConfig
  testedDrift?: TestedDriftItem[]
}

/** GH267 — ce que le signataire a vu pour une exigence : registre, posé par l'application à la signature. */
export interface ValidationAtSignature {
  status: string
  designVersion?: { id: string; title: string }
  coverageStatus: CoverageStatus
  impact?: ValidationImpact
  tests: Array<{ id: string; title: string; local: boolean; lastRun?: ValidationSignedRun }>
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
  /** GH267 — copie posée à la signature, jamais reprise ni écrite par le MCP. */
  atSignature?: ValidationAtSignature
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

/** GH267 — validation qui se lit dans ses copies : signée ou annulée après signature, avec au moins une copie. */
export function isValidationFrozen(state: ValidationState, validation: Pick<Validation, 'entries'>): boolean {
  return state !== 'open' && validation.entries.some(e => e.atSignature)
}

export function pendingDecision(typeDef: Pick<ObjectTypeDefinition, 'decisions'> | null | undefined): ValidationDecisionDef | undefined {
  return typeDef?.decisions?.find(d => d.isPending)
}

/** Raison du refus d'un type validation, `null` s'il est valide. */
export function validationTypeError(typeDef: Pick<ObjectTypeDefinition, 'name' | 'decisions' | 'statuses' | 'trackStatusHistory'>): string | null {
  const decisions = typeDef.decisions ?? []
  const pending = decisions.filter(d => d.isPending).length
  if (pending !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement une décision « en attente » (${pending}).`
  const names = decisions.map(d => d.name)
  if (names.some(n => !n)) return `Le type validation "${typeDef.name}" a une décision sans nom.`
  if (new Set(names).size !== names.length) return `Le type validation "${typeDef.name}" a deux décisions de même nom.`
  const statuses = typeDef.statuses ?? []
  if (statuses.filter(s => s.isApproval).length !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement un statut d'approbation (signée).`
  if (statuses.filter(s => s.isTerminal).length !== 1) return `Le type validation "${typeDef.name}" doit avoir exactement un statut terminal (annulée).`
  // Statut de création : ni signée, ni annulée, sinon une validation naîtrait avec un feu vert.
  if (statuses[0]?.isApproval || statuses[0]?.isTerminal) return `Le premier statut du type validation "${typeDef.name}" doit être un statut en cours.`
  // Le signataire et la date de signature sont lus dans l'historique du statut.
  if (typeDef.trackStatusHistory === false) return `Le type validation "${typeDef.name}" doit historiser son statut (signataire et date de signature).`
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
  /** Tests liés (workspace). `local` : du repo de la validation, dont les exécutions sont lisibles ici. */
  tests: Array<{ id: string; title: string; local: boolean; lastRun?: ValidationSignedRun }>
  impact: ValidationImpact | null
  /** Décision en vigueur : celle de l'entrée, sinon la valeur `isPending`. */
  decision: string
  entry: ValidationEntry | null
  /** À revoir : contenu modifié depuis la décision, décision reprise d'une exigence devenue impactée, ou d'une validation annulée. */
  review: 'content' | 'impact' | 'source' | null
  /** GH267 — fichier signé sans copie pour cette exigence (fusion git, par exemple). */
  outsideSignature?: boolean
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
  /** GH267 — `copy` : colonnes lues dans les copies ; `legacy` : signée sans copie, lecture directe. */
  frozen: 'copy' | 'legacy' | null
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
