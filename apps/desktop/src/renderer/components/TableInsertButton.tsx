import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/react'
import { Table } from 'lucide-react'
import { TableSizePicker } from '../tiptap/TableSizePicker'

interface Props {
  editor: Editor | null | undefined
  disabled?: boolean
  className?: string
}

// Bouton partagé "Insérer un tableau", utilisé à la fois par la toolbar
// contextuelle (RichTextToolbar) et la toolbar inline standalone
// (RichTextField sans RichTextContext) — même pattern que DrawioInsertButton.
export function TableInsertButton({ editor, disabled, className }: Props) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [picker, setPicker] = useState<{ top: number; left: number } | null>(null)

  const handleClick = () => {
    if (!editor) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setPicker({ top: rect.bottom + 2, left: rect.left })
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={e => { e.preventDefault(); handleClick() }}
        disabled={disabled || !editor}
        title={t('tableInsert.insertTable')}
        className={className}
      >
        <Table size={13} />
      </button>
      {picker && (
        <TableSizePicker
          top={picker.top}
          left={picker.left}
          onPick={(rows, cols) => {
            editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
