import { useTranslation } from 'react-i18next'
import { useRichText } from '../../contexts/RichTextContext'
import { DrawioInsertButton } from '../DrawioInsertButton'
import { ImageInsertButton } from '../ImageInsertButton'
import { TableInsertButton } from '../TableInsertButton'

interface Props {
  repoPath?: string
}

export function RichTextToolbar({ repoPath }: Props) {
  const { t } = useTranslation()
  const ctx = useRichText()
  if (!ctx?.isActive) return null

  const { activeEditor, isRaw, toggleRaw } = ctx

  const btn = (active: boolean, disabled = false) =>
    `inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 text-xs rounded text-ink-2 hover:bg-hover transition-colors ${active ? 'bg-hover text-ink' : ''} ${disabled ? 'opacity-40 pointer-events-none' : ''}`

  return (
    <div className="flex gap-0.5 items-center" data-richtext-toolbar>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleBold().run() }}
        className={btn(!!activeEditor?.isActive('bold'), isRaw)}
      ><strong>B</strong></button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleItalic().run() }}
        className={btn(!!activeEditor?.isActive('italic'), isRaw)}
      ><em>I</em></button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleStrike().run() }}
        className={btn(!!activeEditor?.isActive('strike'), isRaw)}
      ><s>S</s></button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleCode().run() }}
        className={btn(!!activeEditor?.isActive('code'), isRaw)}
        title={t('system.shared.inlineCode')}
      ><span className="font-mono">{"`…`"}</span></button>
      <span className="w-px h-4 bg-edge mx-1" />
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleHeading({ level: 2 }).run() }}
        className={btn(!!activeEditor?.isActive('heading', { level: 2 }), isRaw)}
      >H2</button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleHeading({ level: 3 }).run() }}
        className={btn(!!activeEditor?.isActive('heading', { level: 3 }), isRaw)}
      >H3</button>
      <span className="w-px h-4 bg-edge mx-1" />
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleBulletList().run() }}
        className={btn(!!activeEditor?.isActive('bulletList'), isRaw)}
      >{"• —"}</button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleOrderedList().run() }}
        className={btn(!!activeEditor?.isActive('orderedList'), isRaw)}
      >1.</button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleBlockquote().run() }}
        className={btn(!!activeEditor?.isActive('blockquote'), isRaw)}
      >&#10077;</button>
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); activeEditor?.chain().focus().toggleCodeBlock().run() }}
        className={btn(!!activeEditor?.isActive('codeBlock'), isRaw)}
        title={t('system.shared.codeBlock')}
      ><span className="font-mono text-xs">{"{ }"}</span></button>
      <span className="w-px h-4 bg-edge mx-1" />
      <ImageInsertButton editor={activeEditor} repoPath={repoPath} disabled={isRaw} className={btn(false, isRaw)} />
      <DrawioInsertButton editor={activeEditor} repoPath={repoPath} disabled={isRaw} className={btn(false, isRaw)} />
      <TableInsertButton editor={activeEditor} disabled={isRaw} className={btn(false, isRaw)} />
      <span className="w-px h-4 bg-edge mx-1" />
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); toggleRaw() }}
        className={btn(isRaw)}
        title={t('system.richTextToolbar.rawMarkdownMode')}
      >Raw</button>
    </div>
  )
}
