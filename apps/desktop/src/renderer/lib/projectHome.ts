import type { ProjectHome } from '@polenta/types'

/**
 * GH45 S2b — vue d'ouverture d'un projet selon la configuration de l'équipe (`projectHome`).
 * Sans configuration : le tableau de bord, comme avant.
 */
export function projectHomeRoute(projectId: string, home: ProjectHome | undefined) {
  switch (home) {
    case 'requirements':
    case 'tests':
    case 'campaigns': {
      const category = home === 'requirements' ? 'requirement' : home === 'tests' ? 'test' : 'campaign'
      return {
        to: '/product' as const,
        search: { projectId, tab: undefined, repo: undefined, node: undefined, type: undefined, category },
      }
    }
    default:
      return { to: '/dashboard' as const, search: { projectId, dashboardId: undefined } }
  }
}
