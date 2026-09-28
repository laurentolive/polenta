import { createContext, startTransition, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * T169 — porte de rendu partagée par les cellules d'un tableau : une cellule n'est rendue
 * (rendu coûteux, ex. richtext mis en forme) que lorsqu'elle est visible à l'écran ET que le
 * défilement est au repos. Un seul IntersectionObserver et un seul listener `scroll` pour
 * tout le tableau, pas un par cellule.
 *
 * - Visible = intersecte le conteneur défilant (`rootMargin: 0` : pas de préchargement).
 * - Pendant un défilement continu, rien n'est rendu ; à l'arrêt (`idleMs` sans évènement
 *   `scroll`), seules les cellules encore visibles le sont — les lignes simplement traversées
 *   ne le sont jamais.
 * - Sans défilement (ouverture, filtre, dépliage, redimensionnement), le rendu est immédiat —
 *   dès le premier affichage pour une cellule déjà visible (vérifiée avant peinture), sans passer
 *   par une frame de texte brut (flash brut → mis en forme à l'ouverture de la vue).
 * - Une cellule rendue le reste (désinscrite de l'observateur).
 * - En tâche de fond : une fois le visible rendu, les cellules restantes le sont par lots de
 *   `backgroundBatch`, pendant les temps morts du navigateur (`requestIdleCallback`), les plus
 *   proches de l'écran d'abord (en dessous avant au-dessus), en transition React
 *   (interruptible). Suspendu pendant un défilement, repris à l'arrêt. Une cellule au-dessus de
 *   l'écran qui change de hauteur ne décale pas la vue (ancrage de défilement du navigateur).
 */

interface RenderGate {
  register: (el: Element, onRender: () => void) => () => void
  /** Visible dans le conteneur et défilement au repos, lu tout de suite (avant peinture). */
  isVisibleNow: (el: Element) => boolean
}

const RenderGateContext = createContext<RenderGate | null>(null)

export function RenderGateProvider({
  rootRef,
  idleMs = 150,
  backgroundBatch = 12,
  children,
}: {
  rootRef: React.RefObject<HTMLElement>
  idleMs?: number
  /** Cellules rendues par lot en tâche de fond ; 0 = pas de rendu en tâche de fond. */
  backgroundBatch?: number
  children: React.ReactNode
}) {
  const gateRef = useRef<RenderGate | null>(null)
  const pendingRef = useRef(new Map<Element, () => void>())
  const intersectingRef = useRef(new Set<Element>())
  const scrollingRef = useRef(false)
  const ioRef = useRef<IntersectionObserver | null>(null)
  const idleHandleRef = useRef<number | null>(null)
  const mountedRef = useRef(false)

  function renderEl(el: Element, onRender: () => void) {
    pendingRef.current.delete(el)
    intersectingRef.current.delete(el)
    ioRef.current?.unobserve(el)
    onRender()
  }

  /** Planifie le prochain lot de fond (no-op si déjà planifié, en défilement ou rien à faire). */
  function scheduleBackground() {
    if (!backgroundBatch || !mountedRef.current || idleHandleRef.current !== null) return
    if (scrollingRef.current || pendingRef.current.size === 0) return
    idleHandleRef.current = requestIdleCallback(runBackgroundBatch)
  }

  function runBackgroundBatch() {
    idleHandleRef.current = null
    const root = rootRef.current
    if (!root || scrollingRef.current || pendingRef.current.size === 0) return
    const b = root.getBoundingClientRect()
    // Distance à la zone visible : 0 si visible ; en dessous d'abord, puis au-dessus.
    const ranked: Array<[number, Element, () => void]> = []
    for (const [el, onRender] of pendingRef.current) {
      const r = el.getBoundingClientRect()
      const dist = r.bottom <= b.top ? 1e9 + (b.top - r.bottom)
        : r.top >= b.bottom ? r.top - b.bottom
        : 0
      ranked.push([dist, el, onRender])
    }
    ranked.sort((x, y) => x[0] - y[0])
    startTransition(() => {
      for (const [, el, onRender] of ranked.slice(0, backgroundBatch)) renderEl(el, onRender)
    })
    scheduleBackground()
  }

  function flush() {
    const io = ioRef.current
    for (const el of intersectingRef.current) {
      const onRender = pendingRef.current.get(el)
      if (!onRender) continue
      pendingRef.current.delete(el)
      io?.unobserve(el)
      onRender()
    }
    intersectingRef.current.clear()
    scheduleBackground()
  }

  if (!gateRef.current) {
    gateRef.current = {
      isVisibleNow(el) {
        if (scrollingRef.current) return false
        const r = el.getBoundingClientRect()
        // Au montage, la ref du conteneur n'est pas encore attachée quand les effets de layout
        // des cellules s'exécutent (React attache les refs des enfants avant celle du parent) :
        // on se rabat alors sur la fenêtre, que le conteneur occupe jusqu'en bas à droite.
        const root = rootRef.current
        const b = root ? root.getBoundingClientRect() : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
        return r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right
      },
      register(el, onRender) {
        pendingRef.current.set(el, onRender)
        ioRef.current?.observe(el)
        scheduleBackground()
        return () => {
          pendingRef.current.delete(el)
          intersectingRef.current.delete(el)
          ioRef.current?.unobserve(el)
        }
      },
    }
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    mountedRef.current = true
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersectingRef.current.add(entry.target)
        else intersectingRef.current.delete(entry.target)
      }
      if (!scrollingRef.current) flush()
    }, { root, rootMargin: '0px' })
    ioRef.current = io
    // Cellules enregistrées avant la création de l'observateur (effets enfants exécutés
    // avant celui du provider).
    for (const el of pendingRef.current.keys()) io.observe(el)
    scheduleBackground()

    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      scrollingRef.current = true
      if (idleHandleRef.current !== null) {
        cancelIdleCallback(idleHandleRef.current)
        idleHandleRef.current = null
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        scrollingRef.current = false
        flush()
      }, idleMs)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
      mountedRef.current = false
      if (idleHandleRef.current !== null) {
        cancelIdleCallback(idleHandleRef.current)
        idleHandleRef.current = null
      }
      io.disconnect()
      ioRef.current = null
      intersectingRef.current.clear()
      scrollingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, idleMs])

  return <RenderGateContext.Provider value={gateRef.current}>{children}</RenderGateContext.Provider>
}

/** `true` une fois l'élément visible au repos ou rendu en tâche de fond (voir
 *  `RenderGateProvider`), puis reste `true`.
 *  `enabled = false` : l'élément ne s'inscrit pas (et le résultat n'est pas utilisé).
 *  Hors provider : `true` (rendu immédiat). */
export function useRenderWhenVisibleAtRest(ref: React.RefObject<Element>, enabled = true): boolean {
  const gate = useContext(RenderGateContext)
  const [rendered, setRendered] = useState(!gate)
  // Effet de layout : une cellule déjà visible est rendue avant la première peinture.
  useLayoutEffect(() => {
    if (!gate || !enabled || rendered) return
    const el = ref.current
    if (!el) return
    if (gate.isVisibleNow(el)) { setRendered(true); return }
    return gate.register(el, () => setRendered(true))
  }, [gate, enabled, rendered, ref])
  return rendered
}
