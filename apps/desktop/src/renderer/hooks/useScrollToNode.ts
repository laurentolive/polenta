import { useEffect, type RefObject } from 'react'

/**
 * T164 — "goto" : fait défiler `containerRef` jusqu'à l'élément portant
 * `data-node-id={nodeId}` (une ligne de tableau, une carte, un en-tête de section…).
 *
 * `seq` s'incrémente à chaque nouvelle requête côté appelant : il permet de re-déclencher
 * le défilement même quand `nodeId` est identique à la requête précédente (re-clic sur le
 * même élément de l'arbre, re-dépôt d'un drag & drop).
 *
 * No-op silencieux si `nodeId` est null/vide ou si aucun élément ne porte cet attribut
 * (élément masqué par un filtre, dans un dossier replié, pas encore monté…).
 */
export function useScrollToNode(
  containerRef: RefObject<HTMLElement | null>,
  nodeId: string | null | undefined,
  seq: number | undefined,
): void {
  useEffect(() => {
    if (!nodeId || !containerRef.current) return
    containerRef.current
      .querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [containerRef, nodeId, seq])
}
