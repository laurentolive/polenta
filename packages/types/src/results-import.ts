/**
 * GH129 — import de résultats JUnit sans interface (CLI `polenta import-results`, outil MCP
 * `import_test_results`) : rapport commun aux deux points d'entrée (specs/GH129.md §4–§5).
 */
import type { TestRunResult } from './test'

/** Raison pour laquelle un résultat JUnit n'a pas donné de run. */
export type ResultsImportReason =
  | 'unmapped'
  | 'ambiguous'
  | 'not_in_campaign'
  | 'readonly_node'
  | 'required_field_missing'

export type ResultsImportWarningCode =
  | 'mapped_by_requirement'
  | 'unknown_requirement'
  | 'no_timestamp'
  | 'test_not_approved'
  | 'tested_version_undocumented'
  | 'no_automation_field'

/** Erreur globale : rien n'est écrit (sauf `write_failed`, interruption en cours d'écriture). */
export type ResultsImportErrorCode =
  | 'no_files'
  | 'file_unreadable'
  | 'invalid_xml'
  | 'campaign_not_found'
  | 'campaign_closed'
  | 'tested_version_required'
  | 'write_failed'

export interface ResultsImportItem {
  testId: string
  /** Repo du test, absent pour le repo ouvert. */
  repo?: string
  entryId?: string
  /** Absent en dry run. */
  runId?: string
  result: TestRunResult
  /** `fichier · classname.name` de chaque résultat agrégé. */
  sources: string[]
}

export interface ResultsImportRejection {
  file: string
  /** `classname.name` (ou `name` seul sans classname). */
  testcase: string
  reason: ResultsImportReason
  /** IDs candidats (`ambiguous`) ou test trouvé (autres raisons). */
  candidates?: string[]
  /** `required_field_missing` : champ en cause. */
  field?: string
}

export interface ResultsImportWarning {
  code: ResultsImportWarningCode
  file?: string
  testcase?: string
  testId?: string
  detail?: string
}

export interface ResultsImportReport {
  dryRun: boolean
  files: string[]
  counts: {
    /** `<testcase>` lus. */
    results: number
    /** Runs écrits (ou à écrire en dry run). */
    imported: number
    /** Cas de test déjà importés avec la même date (aucun run). */
    alreadyImported: number
    /** `<testcase>` `skipped`. */
    skipped: number
    unmapped: number
    ambiguous: number
    /** Autres raisons (`not_in_campaign`, `readonly_node`, `required_field_missing`). */
    rejected: number
  }
  imported: ResultsImportItem[]
  alreadyImported: Array<{ testId: string; entryId?: string; runId: string }>
  notImported: ResultsImportRejection[]
  warnings: ResultsImportWarning[]
  /** 0 : tout ce qui n'est pas ignoré est importé ; 1 : au moins un résultat non importé. */
  exitCode: 0 | 1
}
