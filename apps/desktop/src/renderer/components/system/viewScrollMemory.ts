import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

/**
 * GH300 — position de défilement d'une vue Tableau / Document, retrouvée au retour sur la même
 * page d'un onglet (activation de l'onglet, Précédent / Suivant). Clé = onglet + entrée de son
 * historique (`TabHistoryEntry.key`) + page (`viewScrollKey`) : une bascule Tableau ↔ Document par le bouton pousse une
 * nouvelle entrée, sans mémoire, et garde l'ancrage `top` / `item` de GH230.
 *
 * La position est mémorisée comme le premier nœud (`data-node-id`) qui coupe le haut de la zone et
 * son décalage, plus le défilement horizontal : elle tient même si les lignes au-dessus n'ont pas
 * encore leur hauteur finale (rendu progressif, cellules rendues au repos).
 *
 * Module, pas état React : survit au démontage de la vue (changement d'onglet ou de page).
 */
export interface ViewScrollPosition {
  nodeId: string | null
  offset: number
  top: number
  left: number
}

const MAX_ENTRIES = 500
const positions = new Map<string, ViewScrollPosition>()

export function saveViewScroll(key: string, position: ViewScrollPosition): void {
  positions.delete(key)
  positions.set(key, position)
  if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value!)
}

export function readViewScroll(key: string): ViewScrollPosition | undefined {
  return positions.get(key)
}

/** Paramètres d'ancrage GH230 / goto exclus de la clé : ils précisent la page courante (REPLACE)
 *  sans en faire une autre. */
const NON_PAGE_PARAMS = new Set(['top', 'item'])

export function viewScrollKey(tabId: string, entryKey: string, pathname: string, search: Record<string, unknown>): string {
  const params = Object.keys(search)
    .filter(k => !NON_PAGE_PARAMS.has(k) && search[k] !== undefined && search[k] !== '')
    .sort()
    .map(k => `${k}=${String(search[k])}`)
    .join('&')
  return `${tabId}#${entryKey}#${pathname}?${params}`
}

export function captureViewScroll(scroller: HTMLElement): ViewScrollPosition {
  const area = scroller.getBoundingClientRect()
  let nodeId: string | null = null
  let offset = 0
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const rect = el.getBoundingClientRect()
    if (rect.height === 0 || rect.bottom <= area.top) continue
    nodeId = el.dataset.nodeId ?? null
    offset = rect.top - area.top
    break
  }
  return { nodeId, offset, top: scroller.scrollTop, left: scroller.scrollLeft }
}

export function restoreViewScroll(scroller: HTMLElement, position: ViewScrollPosition): void {
  const target = position.nodeId
    ? scroller.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(position.nodeId)}"]`)
    : null
  if (target) {
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - position.offset
  } else {
    scroller.scrollTop = position.top
  }
  scroller.scrollLeft = position.left
}

/**
 * Mémorise la position de `containerRef` sous `key` à chaque défilement et la rétablit quand la
 * vue revient sur une clé déjà mémorisée, une fois `ready` (lignes rendues).
 *
 * Retourne `restoring` : vrai quand la clé courante a une mémoire, la vue doit alors ignorer son
 * ancrage `top` et la cible goto déjà posée à l'arrivée (`gotoSeq` inchangé) — elles datent de la
 * visite précédente. Une nouvelle cible (clic dans l'arbre, lien suivi) l'emporte.
 */
export function useViewScrollMemory(
  containerRef: RefObject<HTMLElement | null>,
  key: string | null | undefined,
  { ready = true, gotoSeq }: { ready?: boolean; gotoSeq?: number } = {},
): { restoring: boolean; blocksGoto: boolean } {
  // Mémoire lue à l'arrivée sur la clé, avec la cible goto de ce moment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const arrival = useMemo(() => ({ key, saved: key ? readViewScroll(key) : undefined, gotoSeq }), [key])
  // Arrivée déjà rétablie (par arrivée, pas par clé : revenir sur la même clé sans démontage,
  // ex. deux onglets sur le même type, la rétablit encore).
  const appliedRef = useRef<object | null>(null)
  const keyRef = useRef(key)
  keyRef.current = key
  const pendingRef = useRef(false)
  pendingRef.current = !!arrival.saved && appliedRef.current !== arrival

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !arrival.saved || !ready || appliedRef.current === arrival) return
    appliedRef.current = arrival
    pendingRef.current = false
    restoreViewScroll(container, arrival.saved)
  }, [containerRef, arrival, ready])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => {
      // En attente de restauration : la position courante (haut de page, goto) n'est pas celle
      // de l'utilisateur.
      if (pendingRef.current || !keyRef.current) return
      saveViewScroll(keyRef.current, captureViewScroll(container))
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [containerRef])

  const restoring = !!arrival.saved
  return { restoring, blocksGoto: restoring && gotoSeq === arrival.gotoSeq }
}
