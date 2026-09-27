import { useLayoutEffect, useRef, useState } from 'react'
import { refocusGrid } from './excelCellStore'

/**
 * T176 — éditeur en place d'une cellule texte de la Vue Excel, à iso-typographie avec la lecture :
 * `<textarea>` transparent sans marge ni bordure, qui hérite police / taille / interligne / couleur
 * du `<td>` (lequel garde ses marges de lecture) et coupe les lignes comme `useCellClamp`
 * (`pre-wrap`, `overflow-wrap: anywhere`). Hauteur = contenu (`field-sizing: content`).
 *
 * Clavier : Entrée = retour à la ligne (multi-ligne) ou valider (mono-ligne) ; Ctrl/Cmd+Entrée =
 * valider ; Échap = annuler ; perte de focus (clic extérieur) = valider.
 */
export function ExcelTextEditor({
  initialValue,
  multiline,
  caretOffset,
  onCommit,
  onCancel,
}: {
  initialValue: string
  multiline: boolean
  /** Position initiale du curseur dans `initialValue` ; absent = fin. */
  caretOffset?: number
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialValue)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Un seul dénouement : Échap puis le `blur` du démontage ne doivent pas aussi valider.
  const doneRef = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    const pos = Math.max(0, Math.min(caretOffset ?? initialValue.length, initialValue.length))
    el.setSelectionRange(pos, pos)
    // Placé une seule fois, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCommit(draft)
  }
  const cancel = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      spellCheck={false}
      onChange={e => setDraft(multiline ? e.target.value : e.target.value.replace(/\r?\n/g, ' '))}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          refocusGrid(ref.current)
          cancel()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !multiline)) {
          e.preventDefault()
          refocusGrid(ref.current)
          commit()
        }
      }}
      // L'édition ne doit ni re-sélectionner la ligne ni rouvrir l'éditeur.
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="block w-full p-0 m-0 border-0 bg-transparent outline-none resize-none overflow-hidden"
      style={{
        font: 'inherit',
        lineHeight: 'inherit',
        color: 'inherit',
        letterSpacing: 'inherit',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        // `field-sizing` (Chromium 123+) n'est pas encore dans les types CSS de React.
        ...({ fieldSizing: 'content' } as React.CSSProperties),
      }}
    />
  )
}
