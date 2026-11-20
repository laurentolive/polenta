import { isOpenCampaignStatus, type ExecutionHistoryRow } from '@polenta/types'

// GH400 — vue Exécutions (specs/GH400-design.md §3) : chemin et paramètres de la route.

/** Exécution ouvrable : entrée vivante d'une campagne (GH197 Q5) — ni retirée, ni remplacée. */
export const canOpenRow = (row: ExecutionHistoryRow) => !!row.campaign && !!row.entry && !row.removed && !row.superseded

/**
 * GH399 — page d'une exécution : page d'exécution si sa campagne est ouverte, relecture sinon ;
 * `null` si elle n'est pas ouvrable (isolée, entrée retirée, essai remplacé, campagne introuvable).
 */
export function runPage(row: ExecutionHistoryRow, repoPath: string, projectId: string): { pathname: string; search: Record<string, string> } | null {
  if (!canOpenRow(row)) return null
  const mode = isOpenCampaignStatus(row.campaign!.status) ? 'execute' : 'run'
  return {
    pathname: `/campaign/${row.campaign!.id}/${mode}/${row.entry!.entryId}`,
    search: { repoPath, projectId },
  }
}

export const EXECUTIONS_PATH = '/executions'

export type ExecutionsViewMode = 'excel' | 'word'

export interface ExecutionsSearch {
  projectId?: string
  repo?: string
  node?: string
  type?: string
  /** Mode affiché ; absent : Tableau. */
  view?: ExecutionsViewMode
  /** ID de campagne : filtre de la colonne Campagne prérempli (lien de la fiche campagne). */
  campaign?: string
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function validateExecutionsSearch(s: Record<string, unknown>): ExecutionsSearch {
  return {
    projectId: str(s['projectId']),
    repo: str(s['repo']),
    node: str(s['node']),
    type: str(s['type']),
    view: s['view'] === 'word' ? 'word' : undefined,
    campaign: str(s['campaign']),
  }
}
