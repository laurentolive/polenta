import { createContext, useContext, useEffect, useRef, useState } from 'react'

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
 * - Sans défilement (ouverture, filtre, dépliage, redimensionnement), le rendu est immédiat.
 * - Une cellule rendue le reste (désinscrite de l'observateur).
 */

interface RenderGate {
  register: (el: Element, onRender: () => void) => () => void
}

const RenderGateContext = createContext<RenderGate | null>(null)

export function RenderGateProvider({
  rootRef,
  idleMs = 150,
  children,
}: {
  rootRef: React.RefObject<HTMLElement>
  idleMs?: number
  children: React.ReactNode
}) {
  const gateRef = useRef<RenderGate | null>(null)
  const pendingRef = useRef(new Map<Element, () => void>())
  const intersectingRef = useRef(new Set<Element>())
  const scrollingRef = useRef(false)
  const ioRef = useRef<IntersectionObserver | null>(null)

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
  }

  if (!gateRef.current) {
    gateRef.current = {
      register(el, onRender) {
        pendingRef.current.set(el, onRender)
        ioRef.current?.observe(el)
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

    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      scrollingRef.current = true
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
      io.disconnect()
      ioRef.current = null
      intersectingRef.current.clear()
      scrollingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, idleMs])

  return <RenderGateContext.Provider value={gateRef.current}>{children}</RenderGateContext.Provider>
}

/** `true` une fois l'élément visible au repos (voir `RenderGateProvider`), puis reste `true`.
 *  `enabled = false` : l'élément ne s'inscrit pas (et le résultat n'est pas utilisé).
 *  Hors provider : `true` (rendu immédiat). */
export function useRenderWhenVisibleAtRest(ref: React.RefObject<Element>, enabled = true): boolean {
  const gate = useContext(RenderGateContext)
  const [rendered, setRendered] = useState(!gate)
  useEffect(() => {
    if (!gate || !enabled || rendered) return
    const el = ref.current
    if (!el) return
    return gate.register(el, () => setRendered(true))
  }, [gate, enabled, rendered, ref])
  return rendered
}
