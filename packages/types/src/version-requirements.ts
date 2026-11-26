import type { SchemaField } from './schema'
import type { VersionFreeze, VersionState } from './product-version'
import type { CoverageStatus } from './traceability'

// GH439 — liste des exigences d'une version (specs/GH439.md) : celles du repo de la version, dans l'état de la
// version (figé au passage released, disque sinon), avec leur statut de vérification.

export interface VersionRequirementRow {
  requirementId: string
  title: string
  objectTypeRef: string
  status: string
  version: number
  /** Champs du type, à l'état de la version. */
  fields: Record<string, unknown>
  /** null : couverture non figée (version released avant GH439). */
  coverageStatus: CoverageStatus | null
  /** IDs des tests liés (couverture figée, ou courante pour une version en cours). */
  tests: string[]
}

/**
 * Origine de la colonne Vérification : `frozen` figée au passage released, `live` calculée à l'instant
 * (version en cours), `missing` version released sans couverture figée.
 */
export type VersionVerificationOrigin = 'frozen' | 'live' | 'missing'

export interface VersionRequirementsPage {
  version: { id: string; title: string; state: VersionState; freeze: VersionFreeze | null }
  verification: VersionVerificationOrigin
  rows: VersionRequirementRow[]
  /** Union des champs des types d'exigence, schéma du gel (ou courant pour une version en cours). */
  requirementFields: SchemaField[]
  requirementTypeLabels: Record<string, string>
  requirementStatusLabels: Record<string, string>
}
