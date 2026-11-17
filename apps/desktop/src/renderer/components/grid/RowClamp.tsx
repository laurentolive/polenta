import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

/**
 * Hauteur max des lignes d'une grille (T168, T169), en lignes de texte — commune à la Vue Excel et
 * aux grilles (GH389, déplacé d'`ExcelView`). Fournie par la grille, lue par les cellules via
 * `useCellClamp` plutôt que propagée en prop à chaque composant de cellule.
 */
export const RowMaxLinesContext = createContext(1)

/** Classe du `<td>` et enveloppe du contenu selon la hauteur max des lignes : à 1, la cellule
 *  reste mono-ligne tronquée (`truncate`) ; au-delà, le texte passe à la ligne et est coupé
 *  (ellipse) après `maxLines` lignes ; à `Infinity`, il n'est pas coupé. */
export function useCellClamp() {
  const maxLines = useContext(RowMaxLinesContext)
  if (maxLines <= 1) {
    return { maxLines, tdClass: 'truncate', wrap: (content: React.ReactNode) => content }
  }
  const style: React.CSSProperties = Number.isFinite(maxLines)
    ? {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: maxLines,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }
    : { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
  return { maxLines, tdClass: '', wrap: (content: React.ReactNode) => <div style={style}>{content}</div> }
}

export function ClampedContent({ children }: { children: React.ReactNode }) {
  const clamp = useCellClamp()
  return <>{clamp.wrap(children)}</>
}

/** Hauteur max « N lignes » d'un rendu richtext mis en forme : `-webkit-line-clamp` est
 *  inopérant sur du HTML en blocs, d'où `max-height` + estompage du bas (masque, indépendant
 *  de la couleur de fond : sélection, survol, colonne figée, thème) seulement si ça déborde.
 *  À `Infinity` (toutes les lignes), aucune borne : le rendu est affiché en entier. */
export function RichtextClamp({ maxLines, children }: { maxLines: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  // Effet de layout : l'estompage du bas est posé dès la première peinture, pas une frame après.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    check()
    // Contenu observé (et pas seulement la boîte bornée) : images et diagrammes draw.io se
    // chargent en asynchrone et font grandir le contenu sans changer la boîte.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [maxLines])
  if (!Number.isFinite(maxLines)) return <div>{children}</div>
  const mask = overflowing ? 'linear-gradient(to bottom, #000 calc(100% - 1rem), transparent)' : undefined
  return (
    <div ref={ref} style={{ maxHeight: `${maxLines}rem`, overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  )
}
