import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { useParamRefs } from '../../contexts/ParamRefContext'

/** T171 — bouton « Insérer un paramètre » des barres d'outils de l'éditeur riche. Masqué hors
 *  d'un `ParamRefProvider`. L'éditeur est capturé au clic : le focus part ensuite dans le
 *  sélecteur, ce qui désactive l'éditeur actif du contexte de barre d'outils partagée. */
export function ParamInsertButton({ editor, className, disabled }: { editor: Editor | null | undefined; className: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const paramRefs = useParamRefs()
  if (!paramRefs) return null
  return (
    <button
      type="button"
      disabled={disabled || !editor}
      title={t('parameters.picker.insert')}
      className={className}
      onMouseDown={e => {
        e.preventDefault()
        const target = editor
        if (!target) return
        paramRefs.openPicker((e.currentTarget as HTMLElement).getBoundingClientRect(), key => {
          target.chain().focus().insertContent({ type: 'text', text: `{${key}}` }).run()
        })
      }}
    >
      <span className="font-mono text-xs">{'{x}'}</span>
    </button>
  )
}
