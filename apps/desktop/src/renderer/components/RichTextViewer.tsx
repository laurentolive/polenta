import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { DrawioEmbed } from '../tiptap/DrawioEmbedExtension'
import { ResizableImage } from '../tiptap/ResizableImageExtension'

interface Props {
  value: string
  className?: string
  /** Requis pour résoudre et ouvrir les diagrammes draw.io insérés dans le contenu. */
  repoPath?: string
}

export function RichTextViewer({ value, className = '', repoPath }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false, allowBase64: true, repoPath }),
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false }),
      DrawioEmbed.configure({ repoPath }),
    ],
    content: value,
    editable: false,
    editorProps: {
      attributes: {
        class:
          'outline-none text-sm text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:p-2 [&_pre]:rounded [&_img]:max-w-full [&_img]:rounded [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-edge [&_th]:bg-hover [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-edge [&_td]:px-2 [&_td]:py-1',
      },
    },
  })

  return <EditorContent editor={editor} className={className} />
}
