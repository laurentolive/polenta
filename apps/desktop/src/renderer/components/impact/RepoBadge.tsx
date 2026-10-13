import type { ElementRepoRef } from '@polenta/types'

/** T175 — nom du composant d'un élément qui n'est pas dans le repo racine de l'analyse. */
export function RepoBadge({ repo }: { repo?: ElementRepoRef }) {
  if (!repo) return null
  return (
    <span className="text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0 truncate max-w-[8rem]" title={repo.path}>
      {repo.name}
    </span>
  )
}
