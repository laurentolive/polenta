// GH400 — vue Exécutions (specs/GH400-design.md §3) : chemin et paramètres de la route.

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
