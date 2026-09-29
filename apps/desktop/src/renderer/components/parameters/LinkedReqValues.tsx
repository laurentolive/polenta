import type { ReactNode } from 'react'
import { ReqRefLinkedProvider } from '../../contexts/ParamRefContext'
import { useParamPreview } from '../../hooks/useParamPreview'

/**
 * T179 — exigences liées au test `testId` et valeurs de ses `{req.<champ>}` (état courant, même
 * résolution qu'à l'ajout en campagne) : alimente le survol des références dans ses étapes.
 * Porte sur le test enregistré — un champ tout juste saisi n'a sa valeur au survol qu'après
 * enregistrement.
 */
export function LinkedReqValues({ repoPath, testId, workspaceDir, children }: {
  repoPath: string
  testId: string | null | undefined
  workspaceDir: string
  children: ReactNode
}) {
  const { previews } = useParamPreview(repoPath, {}, testId ? [testId] : [], workspaceDir, !!testId)
  const linked = testId ? previews.get(testId)?.requirements : undefined
  return <ReqRefLinkedProvider linked={linked}>{children}</ReqRefLinkedProvider>
}
