import type { CampaignStatus, TestRunStatus } from './campaign'
import type { StepResultValue, TestRunResult } from './test'

// GH36 — classeur Excel d'exécution hors outil (export d'une campagne, saisie par les testeurs,
// réimport des résultats). Format natif fixe : la lecture se fait par position de colonne et par
// clé technique masquée, jamais par libellé — les libellés ci-dessous ne servent qu'à l'affichage
// dans le classeur et à la reconnaissance des verdicts saisis (toutes langues confondues).

export const EXECUTION_SHEET_FORMAT_VERSION = 1

export type ExecutionSheetLocale = 'fr' | 'en'

/** Colonnes de la feuille de saisie, dans l'ordre (A…L). */
export const EXECUTION_SHEET_COLUMNS = [
  'key', 'instance', 'step', 'text', 'expected', 'requirement', 'params',
  'currentStatus', 'verdict', 'tester', 'date', 'comment',
] as const

export type ExecutionSheetColumn = typeof EXECUTION_SHEET_COLUMNS[number]

/** Ligne des en-têtes de colonnes ; les données commencent à la ligne suivante. */
export const EXECUTION_SHEET_HEADER_ROW = 5

/** Nom de la feuille technique (masquée) portant l'identité du fichier. */
export const EXECUTION_SHEET_META_NAME = '_polenta'

export interface ExecutionSheetLabels {
  sheetName: string
  headers: Record<ExecutionSheetColumn, string>
  stepVerdicts: Record<StepResultValue, string>
  globalVerdicts: Record<TestRunResult, string>
  runStatuses: Record<TestRunStatus, string>
  banner: string
  exportedAt: string
  baseline: string
  preconditions: string
  postconditions: string
  testNotFound: string
  image: string
  diagram: string
}

// Libellés de verdict alignés sur ceux de l'écran d'exécution (`campaignPage.runStatus.*`,
// `campaignPage.stepResult.*` des fichiers i18n) — un testeur retrouve les mêmes mots.
export const EXECUTION_SHEET_LABELS: Record<ExecutionSheetLocale, ExecutionSheetLabels> = {
  fr: {
    sheetName: 'Exécution',
    headers: {
      key: 'Clé',
      instance: 'Instance',
      step: 'Étape',
      text: 'Test / Action',
      expected: 'Résultat attendu',
      requirement: 'Exigence',
      params: 'Paramètres',
      currentStatus: 'Statut actuel',
      verdict: 'Verdict',
      tester: 'Testeur',
      date: "Date d'exécution",
      comment: 'Commentaire',
    },
    stepVerdicts: { PASS: 'Passé', FAIL: 'Échoué', BLOCKED: 'Bloqué', SKIP: 'Ignoré', NOT_EXECUTED: 'Non exécuté' },
    globalVerdicts: { PASS: 'Passé', FAIL: 'Échoué', BLOCKED: 'Bloqué', INCOMPLETE: 'Incomplet' },
    runStatuses: { pending: 'En attente', PASS: 'Passé', FAIL: 'Échoué', BLOCKED: 'Bloqué', INCOMPLETE: 'Incomplet' },
    banner: 'Remplir uniquement les colonnes Verdict, Testeur, Date et Commentaire. Ne pas modifier les autres colonnes ni supprimer de lignes : le fichier sera réimporté dans Polenta.',
    exportedAt: 'Exporté le',
    baseline: 'Baseline',
    preconditions: 'Préconditions',
    postconditions: 'Postconditions',
    testNotFound: '(test introuvable)',
    image: '[image]',
    diagram: '[diagramme]',
  },
  en: {
    sheetName: 'Execution',
    headers: {
      key: 'Key',
      instance: 'Instance',
      step: 'Step',
      text: 'Test / Action',
      expected: 'Expected result',
      requirement: 'Requirement',
      params: 'Parameters',
      currentStatus: 'Current status',
      verdict: 'Verdict',
      tester: 'Tester',
      date: 'Execution date',
      comment: 'Comment',
    },
    stepVerdicts: { PASS: 'Passed', FAIL: 'Failed', BLOCKED: 'Blocked', SKIP: 'Skipped', NOT_EXECUTED: 'Not executed' },
    globalVerdicts: { PASS: 'Passed', FAIL: 'Failed', BLOCKED: 'Blocked', INCOMPLETE: 'Incomplete' },
    runStatuses: { pending: 'Pending', PASS: 'Passed', FAIL: 'Failed', BLOCKED: 'Blocked', INCOMPLETE: 'Incomplete' },
    banner: 'Fill in only the Verdict, Tester, Date and Comment columns. Do not change other columns or delete rows: the file will be re-imported into Polenta.',
    exportedAt: 'Exported on',
    baseline: 'Baseline',
    preconditions: 'Preconditions',
    postconditions: 'Postconditions',
    testNotFound: '(test not found)',
    image: '[image]',
    diagram: '[diagram]',
  },
}

function normalizeVerdict(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')
}

function verdictParser<V extends string>(pick: (l: ExecutionSheetLabels) => Record<V, string>): (raw: string) => V | null {
  const table = new Map<string, V>()
  for (const labels of Object.values(EXECUTION_SHEET_LABELS)) {
    for (const [code, label] of Object.entries(pick(labels)) as [V, string][]) {
      table.set(normalizeVerdict(code), code)
      table.set(normalizeVerdict(label), code)
    }
  }
  return raw => table.get(normalizeVerdict(raw)) ?? null
}

/** Verdict d'étape saisi : code (`FAIL`) ou libellé de n'importe quelle langue, casse et espaces
 *  ignorés ; `null` si non reconnu. */
export const parseStepVerdict = verdictParser<StepResultValue>(l => l.stepVerdicts)

/** Verdict global saisi (mêmes règles que `parseStepVerdict`). */
export const parseGlobalVerdict = verdictParser<TestRunResult>(l => l.globalVerdicts)

// ─── Import ───────────────────────────────────────────────────────────────────

export type ExecutionImportFatal =
  | { code: 'unreadable' }
  | { code: 'not_an_execution_sheet' }
  | { code: 'unsupported_version'; version: string }
  | { code: 'wrong_campaign'; fileCampaignId: string }
  | { code: 'campaign_closed'; status: CampaignStatus }

export type ExecutionImportInstanceError =
  | { code: 'entry_not_found' }
  | { code: 'test_not_found'; testCaseId: string }
  | { code: 'steps_mismatch'; expected: number[]; found: number[] }
  /** `row` : numéro de ligne Excel (1-based). */
  | { code: 'invalid_verdict'; row: number; value: string }
  | { code: 'invalid_date'; row: number; value: string }

export interface ImportedInstance {
  entryId: string
  testCaseId: string
  requirementId?: string
  title: string
  /** Statut de l'instance avant import ; ≠ `pending` → le résultat existant est remplacé. */
  previousStatus: TestRunStatus
  result: TestRunResult
  /** Verdict global saisi dans le fichier (sinon calculé depuis les étapes). */
  resultForced: boolean
  executedBy: string
  /** ISO 8601. */
  executedAt: string
  /** Markdown. */
  notes: string
  stepResults: { order: number; result: StepResultValue; comment: string }[]
}

export interface ExecutionImportPreview {
  filePath: string
  fileName: string
  /** Présent : le fichier entier est refusé, `importable` est vide. */
  fatal?: ExecutionImportFatal
  importable: ImportedInstance[]
  errors: { entryId: string; error: ExecutionImportInstanceError }[]
  warnings: { code: 'row_without_key'; row: number }[]
  /** Instances présentes dans le fichier mais sans aucun verdict (laissées inchangées). */
  unfilledCount: number
}

export interface ExecutionImportResult {
  /** `entryId` écrits, dans l'ordre. */
  imported: string[]
  /** Arrêt en cours de route : instance en échec (les précédentes restent écrites). */
  failure?: { entryId: string; message: string }
  /** Aperçu recalculé au moment de l'écriture (le fichier est relu). */
  preview: ExecutionImportPreview
}
