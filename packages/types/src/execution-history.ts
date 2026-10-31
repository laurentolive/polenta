import type { CampaignStatus, CarriedFrom } from './campaign'
import type { SchemaField } from './schema'
import type { TestRun } from './test'

// GH197 — grille d'historique des exécutions (specs/GH197.md) : une ligne par run d'un test, ou des
// tests qui couvrent une exigence (règle T179), plus les entrées en attente des campagnes ouvertes.
// Données brutes assemblées par le main ; aucun indicateur calculé (GH79).

export type ExecutionHistoryTarget = { testId: string } | { requirementId: string }

export interface ExecutionHistoryRow {
  /** Id du run, ou `pending:<campagne>:<entrée>` pour une entrée en attente. */
  key: string
  kind: 'run' | 'pending'
  testCaseId: string
  testTitle: string
  objectTypeRef: string
  run?: TestRun
  campaign?: { id: string; title: string; status: CampaignStatus; baselineRef?: string; fields: Record<string, unknown> }
  entry?: {
    entryId: string
    requirementId?: string
    paramValues?: Record<string, string>
    resolvedParams?: Record<string, string>
    /** Version du test exécutée (copie figée de l'entrée). */
    testVersion?: number
    carriedFrom?: CarriedFrom
  }
  /** Entrée de campagne retirée depuis l'exécution (GH73) : ligne conservée. */
  removed?: boolean
  /** Run rattaché à une campagne introuvable (supprimée, autre repo). */
  campaignMissing?: boolean
  /** Run remplacé par un nouvel essai sur la même entrée : données d'entrée et ouverture non reprises. */
  superseded?: boolean
}

/** Campagne ouverte (planifiée ou en cours) : ses entrées en attente sont listées, une ligne ouvre
 *  la page d'exécution (Q5) ; clôturée : consultation. */
export function isOpenCampaignStatus(status: string): boolean {
  return status === 'planned' || status === 'in_progress'
}

export interface ExecutionHistory {
  rows: ExecutionHistoryRow[]
  /** Champs d'exécution / d'étape de chaque type de test présent, par `objectTypeRef`. */
  runFieldDefs: Record<string, { runFields: SchemaField[]; stepFields: SchemaField[] }>
}

/** Ordre par défaut (Q6) : entrées en attente en tête, puis date d'exécution décroissante. */
export function sortExecutionHistory(rows: ExecutionHistoryRow[]): ExecutionHistoryRow[] {
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'pending' ? -1 : 1
    const da = a.run?.executedAt ?? ''
    const db = b.run?.executedAt ?? ''
    return da < db ? 1 : da > db ? -1 : a.key.localeCompare(b.key)
  })
}
