import type { ReactNode } from 'react'
import { useElementNav } from '../../contexts/ElementNavContext'
import { normRepoPath } from '../system/linkUtils'
import { ElementLink } from './ElementLink'

/**
 * GH389 §1.8 — ID d'une version ou d'une validation d'un repo donné : lien d'élément (popup d'en-tête,
 * Ctrl+clic) quand l'index le connaît dans ce repo ; sinon (composant non indexé, même ID dans un
 * autre repo) bouton vers la page, comme avant.
 */
export function PageLink({ id, repoPath, className, onFallback, children }: {
  id: string
  repoPath: string
  className?: string
  onFallback: () => void
  children: ReactNode
}) {
  const nav = useElementNav()
  const target = nav?.resolve(id)
  if (target && normRepoPath(target.repoPath) === normRepoPath(repoPath)) {
    return <ElementLink id={id} className={className}>{children}</ElementLink>
  }
  return (
    <button type="button" data-page-link={id} data-cell-dblclick-ignore className={['hover:underline', className ?? ''].join(' ')}
      onClick={e => { e.stopPropagation(); onFallback() }}>
      {children}
    </button>
  )
}
