import { useContext, useMemo, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { InPreviewContext, useElementNav, type ElementNav } from '../../contexts/ElementNavContext'
import { findElementRefs } from '../../lib/elementRefs'
import { ElementLink } from './ElementLink'

/** Élément `[data-element-ref]` visé par un événement, s'il appartient à l'index. */
function refTarget(nav: ElementNav, e: { target: EventTarget | null }): { el: HTMLElement; id: string } | null {
  const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-element-ref]')
  const id = el?.dataset.elementRef
  return el && id && nav.resolve(id) ? { el, id } : null
}

/**
 * GH229 §2.2 — gestes des ID reconnus dans du HTML rendu hors React (markdown-it, décorations
 * Tiptap) : mêmes gestes qu'un `ElementLink`, délégués au conteneur. Sans index (hors projet) :
 * aucun gestionnaire.
 */
export function useElementRefDelegation() {
  const nav = useElementNav()
  const inPreview = useContext(InPreviewContext)
  // Hors du memo : survit à un changement de `nav` (index rechargé pendant le survol).
  const hoveredRef = useRef<HTMLElement | null>(null)
  return useMemo(() => {
    if (!nav) return {}
    return {
      onMouseDown: (e: MouseEvent) => {
        if (!refTarget(nav, e)) return
        e.stopPropagation()
        if (e.button === 1) e.preventDefault()
      },
      onClick: (e: MouseEvent) => {
        const hit = refTarget(nav, e)
        if (!hit) return
        e.stopPropagation()
        e.preventDefault()
        nav.follow(hit.id, { newTab: e.ctrlKey || e.metaKey })
      },
      onAuxClick: (e: MouseEvent) => {
        const hit = e.button === 1 ? refTarget(nav, e) : null
        if (!hit) return
        e.stopPropagation()
        e.preventDefault()
        nav.follow(hit.id, { newTab: true })
      },
      onDoubleClick: (e: MouseEvent) => { if (refTarget(nav, e)) e.stopPropagation() },
      onPointerOver: (e: PointerEvent) => {
        if (inPreview || e.pointerType === 'touch' || e.buttons !== 0) return
        const hit = refTarget(nav, e)
        if (!hit || hit.el === hoveredRef.current) return
        hoveredRef.current = hit.el
        nav.hover(hit.id, hit.el)
      },
      onPointerOut: (e: PointerEvent) => {
        const hovered = hoveredRef.current
        if (!hovered || inPreview) return
        const to = e.relatedTarget as Node | null
        if (to && hovered.contains(to)) return
        hoveredRef.current = null
        nav.leave()
      },
    }
  }, [nav, inPreview])
}

/** `exists` de l'index courant (pour markdown-it / Tiptap), `null` hors projet. */
export function useElementRefExists(): { exists: (id: string) => boolean; version: number } | null {
  const nav = useElementNav()
  return useMemo(() => (nav ? { exists: (id: string) => nav.resolve(id) !== null, version: nav.version } : null), [nav?.version, nav?.resolve]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * GH229 §2.2 — texte simple (champ text / textarea, cellule de résultat) avec ses ID d'élément
 * rendus en liens. Sans ID existant : le texte tel quel.
 */
export function ElementRefText({ text }: { text: string }): ReactNode {
  const nav = useElementNav()
  const refs = nav ? findElementRefs(text, id => nav.resolve(id) !== null) : []
  if (refs.length === 0) return text
  const parts: ReactNode[] = []
  let last = 0
  for (const ref of refs) {
    if (ref.index > last) parts.push(text.slice(last, ref.index))
    // Le texte écrit est affiché tel quel (pas l'ID affiché du type, spec §2.2).
    parts.push(<ElementLink key={ref.index} id={ref.id} className="element-ref">{ref.id}</ElementLink>)
    last = ref.index + ref.id.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
