import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from './projectId'
import { useAppVersion } from './useAppVersion'
import { BRAND } from '../../shared/brand'

/** Titre de fenêtre : `<produit> v<version>`, suivi de `— <projet> — <chemin>` si un projet est ouvert. */
export function windowTitle(version: string, project?: { displayName: string; localPath: string }): string {
  const base = `${BRAND.productName} v${version}`
  return project ? `${base} — ${project.displayName} — ${project.localPath}` : base
}

/**
 * GH338 — tient le titre de fenêtre à jour quel que soit le panneau actif. Appelé depuis
 * `AppLayout` (toujours monté) : avant, `ProjectPanel` le posait, mais n'est monté que lorsque le
 * panneau « Projet » est affiché, si bien qu'au démarrage le titre restait celui de `index.html`.
 */
export function useWindowTitle(projectId: string | null): void {
  const { data: version } = useAppVersion()
  // Même clé que ProjectPanel : une seule résolution du workspace, renommage du projet compris.
  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId!)),
    enabled: !!projectId,
  })

  const displayName = project?.label || project?.name
  const localPath = project?.localPath

  useEffect(() => {
    if (!version) return
    if (!projectId) {
      api.app.setTitle(windowTitle(version))
      return
    }
    // Projet en cours de résolution : on garde le titre courant plutôt que d'afficher un titre
    // sans projet pendant un instant.
    if (displayName && localPath) api.app.setTitle(windowTitle(version, { displayName, localPath }))
  }, [version, projectId, displayName, localPath])
}
