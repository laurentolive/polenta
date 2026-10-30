import { useEffect, useRef, type RefObject } from 'react'
import type { TypeTreeNode } from '@polenta/types'
import { scrollCandidates } from '../components/system/viewAnchor'

export interface ScrollToNodeOptions {
  /** GH230 — arbre de la vue : un nœud non rendu (dossier replié, titres de dossiers masqués…)
   *  cède la place au nœud rendu le plus proche (`scrollCandidates`). */
  root?: TypeTreeNode[]
  /** Faux tant que la vue n'a pas rendu tous ses nœuds : le défilement attend. */
  ready?: boolean
}

/**
 * T164 — "goto" : fait défiler `containerRef` jusqu'à l'élément portant
 * `data-node-id={nodeId}` (une ligne de tableau, une carte, un en-tête de section…).
 * GH230 — placé en haut de la zone (sous son `scroll-margin-top` : en-tête figé du Tableau), sans
 * animation, en ne faisant défiler que `containerRef` : `scrollIntoView` décalait aussi les
 * conteneurs parents (cadre de l'application remonté, double-clic de l'arbre manqué).
 *
 * `seq` s'incrémente à chaque nouvelle requête côté appelant : il permet de re-déclencher
 * le défilement même quand `nodeId` est identique à la requête précédente (re-clic sur le
 * même élément de l'arbre, re-dépôt d'un drag & drop).
 *
 * No-op silencieux si `nodeId` est null/vide ou si aucun élément ne porte cet attribut
 * (élément masqué par un filtre, dans un dossier replié, pas encore monté…) — sauf avec `root`.
 */
export function useScrollToNode(
  containerRef: RefObject<HTMLElement | null>,
  nodeId: string | null | undefined,
  seq: number | undefined,
  { root, ready = true }: ScrollToNodeOptions = {},
): void {
  // L'arbre change à chaque modification : lu par référence, il ne relance pas le défilement.
  const rootRef = useRef(root)
  useEffect(() => { rootRef.current = root }, [root])

  useEffect(() => {
    const container = containerRef.current
    if (!nodeId || !ready || !container) return
    const find = (id: string) => container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
    let target = find(nodeId)
    if (!target && rootRef.current) {
      const rendered = new Set(Array.from(container.querySelectorAll<HTMLElement>('[data-node-id]'), el => el.dataset.nodeId))
      const id = scrollCandidates(rootRef.current, nodeId).find(c => rendered.has(c))
      target = id ? find(id) : null
    }
    if (!target) return
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - margin
  }, [containerRef, nodeId, seq, ready])
}
