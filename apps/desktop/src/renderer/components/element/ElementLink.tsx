import { useContext, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InPreviewContext, useElementNav, type ElementNav } from '../../contexts/ElementNavContext'

/**
 * GH229 — ID d'un autre élément affiché à l'écran (specs/GH229.md §2–3) : texte = ID affiché du
 * type, clic = page de l'élément (vue système, dernier type de vue ; fiche pour une campagne),
 * Ctrl / Cmd / clic du milieu = même page dans un nouvel onglet, survol de 500 ms = popup
 * d'aperçu. Le geste du conteneur (sélection de ligne, édition de cellule) n'est pas déclenché.
 * Élément introuvable, ou hors projet ouvert : texte simple.
 */
export function ElementLink({ id, className, missingClassName, onFollow, children }: {
  id: string
  /** Remplace la navigation commune (l'appelant la rejoint après son propre geste, ex. fermer un
   *  popover). */
  onFollow?: (id: string, opts: { newTab: boolean }) => void
  className?: string
  /** Style de l'ID introuvable (index chargé, élément absent). */
  missingClassName?: string
  /** Remplace le texte du lien (ID affiché par défaut). */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const nav = useElementNav()
  const inPreview = useContext(InPreviewContext)
  const target = nav?.resolve(id) ?? null
  // Un geste propre à l'écran (`onFollow`) reste disponible tant que l'index n'est pas chargé ;
  // sans lui, l'ID n'est un lien que s'il est dans l'index.
  if (!nav || (!target && (!onFollow || nav.ready))) {
    return <span className={nav?.ready ? missingClassName ?? className : className}>{children ?? id}</span>
  }
  const handlers = elementLinkHandlers(nav, id, inPreview || !target, onFollow)
  return (
    <span
      data-element-link={id}
      data-cell-dblclick-ignore
      role="link"
      tabIndex={0}
      className={['cursor-pointer hover:underline', className ?? ''].join(' ')}
      // La popup d'aperçu tient lieu d'infobulle ; l'ID Polenta seulement s'il n'est pas affiché.
      title={target && target.displayId !== id && !children ? id : undefined}
      aria-description={t('system.shared.clickToNavigate')}
      {...handlers}
    >
      {children ?? target?.displayId ?? id}
    </span>
  )
}

/** Gestes d'un lien d'élément, partagés avec les ID reconnus dans le HTML rendu (richtext). */
export function elementLinkHandlers(
  nav: ElementNav, id: string, inPreview: boolean,
  onFollow?: (id: string, opts: { newTab: boolean }) => void,
) {
  const follow = (newTab: boolean) => {
    nav.closePreview()
    if (onFollow) onFollow(id, { newTab })
    else nav.follow(id, { newTab })
  }
  return {
    onMouseDown: (e: MouseEvent) => {
      // Ni sélection de ligne / cellule, ni début de glisser ; le bouton du milieu ne déclenche
      // pas le défilement automatique.
      e.stopPropagation()
      if (e.button === 1) e.preventDefault()
    },
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      follow(e.ctrlKey || e.metaKey)
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return
      e.stopPropagation()
      e.preventDefault()
      follow(true)
    },
    onDoubleClick: (e: MouseEvent) => { e.stopPropagation() },
    // Clavier : Entrée suit le lien (Ctrl / Cmd+Entrée : nouvel onglet), comme un lien.
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      e.stopPropagation()
      e.preventDefault()
      follow(e.ctrlKey || e.metaKey)
    },
    onPointerEnter: (e: PointerEvent) => {
      if (inPreview || e.pointerType === 'touch' || e.buttons !== 0) return
      nav.hover(id, e.currentTarget as HTMLElement)
    },
    onPointerLeave: () => { if (!inPreview) nav.leave() },
  }
}
