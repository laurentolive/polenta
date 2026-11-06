import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

/**
 * GH300 — position de défilement d'une vue Tableau / Document, retrouvée au retour sur la même
 * page d'un onglet : activation de l'onglet, Précédent / Suivant, ou retour par l'arbre / la barre
 * d'activité après un passage par une autre vue (Exigences → Tests → Exigences).
 *
 * Clé = onglet + page (`viewScrollKey` : URL hors `top` / `item`, mode Tableau / Document
 * effectif). Une bascule Tableau ↔ Document par le bouton efface la mémoire de la page visée
 * (`forgetViewScroll`) : elle s'ouvre sur l'élément de GH230 (`top` / `item`).
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
  /** Cible goto (élément choisi dans l'arbre, `item`) au moment du défilement. */
  goto?: string | null
}

const MAX_ENTRIES = 500
const positions = new Map<string, ViewScrollPosition>()

export function saveViewScroll(key: string, position: ViewScrollPosition): void {
  positions.delete(key)
  positions.set(key, position)
  if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value!)
}

export function readViewScroll(key: string | null | undefined): ViewScrollPosition | undefined {
  return key ? positions.get(key) : undefined
}

export function forgetViewScroll(key: string | null | undefined): void {
  if (key) positions.delete(key)
}

/** Paramètres d'ancrage GH230 / goto exclus de la clé : ils précisent la page sans en faire une
 *  autre. `view` est remplacé par le mode effectivement affiché (absent = mode mémorisé du type). */
const NON_PAGE_PARAMS = new Set(['top', 'item', 'view'])

export function viewScrollKey(tabId: string, viewMode: string, pathname: string, search: Record<string, unknown>): string {
  const params = Object.keys(search)
    .filter(k => !NON_PAGE_PARAMS.has(k) && search[k] !== undefined && search[k] !== '')
    .sort()
    .map(k => `${k}=${String(search[k])}`)
    .join('&')
  return `${tabId}#${viewMode}#${pathname}?${params}`
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

function findNode(scroller: HTMLElement, nodeId: string | null): HTMLElement | null {
  return nodeId ? scroller.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`) : null
}

export function restoreViewScroll(scroller: HTMLElement, position: ViewScrollPosition): void {
  const target = findNode(scroller, position.nodeId)
  if (target) {
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - position.offset
  } else {
    scroller.scrollTop = position.top
  }
  scroller.scrollLeft = position.left
}

/**
 * Mémorise la position de `containerRef` sous `key` à chaque défilement et la rétablit, avant
 * peinture, quand la vue arrive sur une clé déjà mémorisée : dès que le nœud mémorisé est rendu,
 * sinon une fois `ready` (toutes les lignes rendues : nœud filtré ou supprimé → position en pixels).
 *
 * `restoring` : la clé courante a une mémoire, la vue ignore alors son ancrage `top`, qui date de
 * la visite précédente. `blocksGoto` : la cible goto qui était posée quand la position a été
 * mémorisée, réappliquée à l'arrivée (`item` de l'URL rejoué par le contexte, parfois après le
 * chargement de l'arbre), ne fait pas défiler — elle reste sélectionnée / entourée. Toute autre
 * cible, ou un nouveau clic sur la même (même nœud, `gotoSeq` incrémenté), l'emporte ; après un
 * goto de l'utilisateur, plus rien n'est bloqué pour cette arrivée.
 */
export function useViewScrollMemory(
  containerRef: RefObject<HTMLElement | null>,
  key: string | null | undefined,
  { ready = true, gotoNodeId, gotoSeq }: { ready?: boolean; gotoNodeId?: string | null; gotoSeq?: number } = {},
): { saved: ViewScrollPosition | undefined; restoring: boolean; blocksGoto: boolean } {
  // Mémoire lue à l'arrivée sur la clé (nouvel objet par arrivée : revenir sur la même clé sans
  // démontage, ex. deux onglets sur le même type, la rétablit encore).
  const arrival = useMemo(() => ({ saved: readViewScroll(key) }), [key])
  const keyRef = useRef(key)
  keyRef.current = key
  const gotoRef = useRef(gotoNodeId)
  gotoRef.current = gotoNodeId
  const appliedRef = useRef<object | null>(null)
  const pendingRef = useRef(false)
  pendingRef.current = !!arrival.saved && appliedRef.current !== arrival

  // Suivi des cibles goto depuis l'arrivée (lu au rendu : décide du défilement de ce rendu).
  const savedGoto = arrival.saved?.goto ?? null
  const gotoTrack = useRef<{ arrival: object; active: boolean; node: string | null; seq: number | undefined; blocked: Set<number | undefined> } | null>(null)
  const node = gotoNodeId ?? null
  let track = gotoTrack.current
  if (!track || track.arrival !== arrival) {
    track = { arrival, active: !!savedGoto, node, seq: gotoSeq, blocked: new Set() }
    if (track.active && node === savedGoto) track.blocked.add(gotoSeq)
    gotoTrack.current = track
  } else if (track.active && (node !== track.node || gotoSeq !== track.seq)) {
    if (node === savedGoto && node !== track.node) track.blocked.add(gotoSeq)
    else if (node) track.active = false
    track.node = node
    track.seq = gotoSeq
  }

  // Sans dépendances : réessaie à chaque rendu tant que le nœud mémorisé n'est pas rendu.
  useLayoutEffect(() => {
    const container = containerRef.current
    const saved = arrival.saved
    if (!container || !saved || appliedRef.current === arrival) return
    if (!findNode(container, saved.nodeId) && !ready) return
    appliedRef.current = arrival
    pendingRef.current = false
    restoreViewScroll(container, saved)
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => {
      // En attente de restauration : la position courante (haut de page, goto) n'est pas celle
      // de l'utilisateur.
      if (pendingRef.current || !keyRef.current) return
      saveViewScroll(keyRef.current, { ...captureViewScroll(container), goto: gotoRef.current ?? null })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [containerRef])

  const restoring = !!arrival.saved
  return { saved: arrival.saved, restoring, blocksGoto: restoring && track.blocked.has(gotoSeq) }
}
