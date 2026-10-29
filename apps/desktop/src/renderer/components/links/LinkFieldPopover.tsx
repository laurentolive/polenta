import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { formatLinksText, readLinkValues } from '@polenta/types'
import { LinkEditor } from './LinkEditor'

// GH195 — édition d'un champ `link` depuis une cellule de la vue Excel : popover ancré (position
// `fixed` calculée par l'appelant, même gabarit que `MultiEnumPopover`). Brouillon local : un clic
// hors du popover ou « OK » / Ctrl+Entrée enregistre, Échap / « Annuler » abandonne.

interface Props {
  value: string
  multiple?: boolean
  /** Forme texte `libellé | URL` ; appelé seulement si la valeur a changé. */
  onCommit: (text: string) => void
  onClose: () => void
  style: CSSProperties
}

export function LinkFieldPopover({ value, multiple, onCommit, onClose, style }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const commit = () => {
    if (formatLinksText(readLinkValues(draftRef.current)) !== formatLinksText(readLinkValues(value))) onCommit(draftRef.current)
    onClose()
  }
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) commitRef.current()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div
      ref={ref}
      data-link-field-popover
      style={{ ...style, position: 'fixed', zIndex: 50 }}
      className="bg-surface border border-edge rounded shadow-lg p-2 space-y-2"
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation() // la grille ne doit pas interpréter les touches saisies ici
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <LinkEditor value={draft} onChange={setDraft} multiple={multiple} autoFocus onSubmit={commit} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary-sm" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn-secondary-sm" onClick={commit}>{t('linkField.ok')}</button>
      </div>
    </div>
  )
}
