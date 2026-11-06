import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { Ban, Baseline, Highlighter } from 'lucide-react'
import {
  highlightClass, RICHTEXT_HIGHLIGHT_COLORS, RICHTEXT_TEXT_COLORS, textColorClass,
  type RichTextHighlightColor, type RichTextTextColor,
} from '@polenta/types'

/** Largeur max du menu (6 pastilles + marges), pour le garder dans la fenêtre. */
const MENU_WIDTH = 200

interface Props {
  editor: Editor | null | undefined
  kind: 'text' | 'highlight'
  disabled?: boolean
  className?: string
}

/**
 * GH299 — bouton « Couleur du texte » / « Surlignage » d'une barre d'outils richtext (partagée
 * `RichTextToolbar` et inline `RichTextField`), même pattern que `TableInsertButton` : `onMouseDown`
 * + `preventDefault` pour garder la sélection de l'éditeur, popover en portail avec voile de fermeture.
 * Le trait sous l'icône reprend la couleur de la sélection.
 */
export function RichTextColorButton({ editor, kind, disabled, className }: Props) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)

  const markName = kind === 'text' ? 'textColor' : 'highlightColor'
  const active = (editor?.getAttributes(markName).color as string | undefined) ?? null
  const colors: readonly string[] = kind === 'text' ? RICHTEXT_TEXT_COLORS : RICHTEXT_HIGHLIGHT_COLORS
  const label = t(kind === 'text' ? 'richTextColor.textColor' : 'richTextColor.highlight')
  const swatchClass = (c: string) => kind === 'text'
    ? textColorClass(c as RichTextTextColor)
    : highlightClass(c as RichTextHighlightColor)

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    // Maintenu dans la fenêtre : un champ au bord droit d'un panneau étroit (cellule Vue Tableau).
    if (rect) setMenu({ top: rect.bottom + 2, left: Math.max(4, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 4)) })
  }

  // Position calculée à l'ouverture : fermé par Échap, au défilement et au redimensionnement
  // plutôt que de flotter loin du bouton.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    // Capture + stopPropagation : Échap ferme le menu sans fermer aussi l'édition de la cellule.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const apply = (color: string | null) => {
    const chain = editor?.chain().focus()
    if (!chain) return
    if (kind === 'text') (color ? chain.setTextColor(color as RichTextTextColor) : chain.unsetTextColor()).run()
    else (color ? chain.setHighlightColor(color as RichTextHighlightColor) : chain.unsetHighlightColor()).run()
    setMenu(null)
  }

  const Icon = kind === 'text' ? Baseline : Highlighter
  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={e => { e.preventDefault(); open() }}
        disabled={disabled || !editor}
        title={label}
        aria-label={label}
        data-richtext-color={kind}
        className={className}
      >
        <span className="inline-flex flex-col items-center leading-none">
          <Icon size={12} />
          <span
            className={`block w-3 h-[3px] mt-px rounded-sm ${active ? `${swatchClass(active)} rt-swatch` : 'bg-ink-3/40'}`}
          />
        </span>
      </button>
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
          <div
            role="menu"
            aria-label={label}
            data-richtext-color-menu={kind}
            style={{ position: 'fixed', top: menu.top, left: menu.left, zIndex: 9999 }}
            className="bg-surface border border-edge rounded shadow-lg p-1.5 flex flex-col gap-1"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex gap-1">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active === c}
                  data-color={c}
                  title={t(`richTextColor.colors.${c}`)}
                  onMouseDown={e => { e.preventDefault(); apply(c) }}
                  className={`w-6 h-6 rounded border text-xs font-semibold inline-flex items-center justify-center ${active === c ? 'border-ink ring-1 ring-ink' : 'border-edge'} ${swatchClass(c)}`}
                >{kind === 'text' ? 'A' : ''}</button>
              ))}
            </div>
            <button
              type="button"
              role="menuitem"
              data-color="none"
              onMouseDown={e => { e.preventDefault(); apply(null) }}
              className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-ink-2 rounded hover:bg-hover"
            >
              <Ban size={12} />
              {t(kind === 'text' ? 'richTextColor.noTextColor' : 'richTextColor.noHighlight')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
