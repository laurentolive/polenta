import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import type { DrawioPage } from '@polenta/api-client'
import { api } from '../api'
import { DrawioLogoIcon } from './DrawioLogoIcon'
import { DrawioPagePicker } from '../tiptap/DrawioPagePicker'

interface Props {
  editor: Editor | null | undefined
  repoPath?: string
  disabled?: boolean
  className?: string
}

const MESSAGE_AUTO_DISMISS_MS = 5000

// Bouton partagé "Insérer un diagramme draw.io", utilisé à la fois par la
// toolbar contextuelle (RichTextToolbar) et la toolbar inline standalone
// (RichTextField sans RichTextContext) — la logique de sélection fichier +
// choix de page ne doit exister qu'à un seul endroit.
export function DrawioInsertButton({ editor, repoPath, disabled, className }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Popovers rendues via un portail dans document.body (comme VersionPanel.tsx),
  // positionnées en position:fixed. La position est capturée AU CLIC, avant tout
  // await : le bouton vit dans une toolbar contextuelle (RichTextToolbar) qui se
  // démonte si le champ perd le focus — le dialogue natif de sélection de fichier
  // provoque justement une perte de focus fenêtre pendant l'await, donc relire
  // buttonRef.current après coup peut retomber sur null.
  const [pagePicker, setPagePicker] = useState<{ path: string; pages: DrawioPage[]; top: number; left: number } | null>(null)
  // Empêche un double-clic de superposer deux dialogues natifs de sélection de
  // fichier (et donc potentiellement deux insertions) pendant les allers-retours IPC.
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error'; top: number; left: number } | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  const showMessage = (anchor: { top: number; left: number }, text: string, tone: 'info' | 'error') => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    setMessage({ text, tone, top: anchor.top, left: anchor.left })
    dismissTimerRef.current = setTimeout(() => setMessage(null), MESSAGE_AUTO_DISMISS_MS)
  }

  const insert = (path: string, nodeId?: string) => {
    if (!editor) return
    const ok = editor.chain().focus().insertContent({ type: 'drawioEmbed', attrs: { path, nodeId: nodeId ?? null } }).run()
    if (!ok) {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) showMessage({ top: rect.bottom + 2, left: rect.left }, "Échec de l'insertion du diagramme (position du curseur invalide ?).", 'error')
    }
  }

  const handleClick = async () => {
    if (!repoPath || !editor || pending) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const anchor = { top: rect.bottom + 2, left: rect.left }
    setPending(true)
    setMessage(null)
    try {
      const picked = await api.drawio.pickFile(repoPath)
      if (picked.status === 'canceled') return
      if (picked.status === 'error') {
        showMessage(anchor, picked.message, 'error')
        return
      }
      const pages = await api.drawio.read(repoPath, picked.path)
      if (!pages || pages.length === 0) {
        showMessage(anchor, 'Aucune page draw.io trouvée dans ce fichier.', 'error')
        return
      }
      if (picked.copied) {
        showMessage(anchor, `Fichier copié dans ${picked.path}`, 'info')
      }
      if (pages.length === 1) {
        insert(picked.path)
        return
      }
      setPagePicker({ path: picked.path, pages, top: anchor.top, left: anchor.left })
    } catch (err) {
      showMessage(anchor, err instanceof Error ? err.message : "Erreur lors de l'insertion du diagramme.", 'error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={e => { e.preventDefault(); void handleClick() }}
        disabled={disabled || !repoPath || pending}
        title={repoPath ? 'Insérer un diagramme draw.io' : 'Insérer un diagramme draw.io (contexte repo indisponible)'}
        className={className}
      >
        <DrawioLogoIcon size={13} />
      </button>
      {pagePicker && (
        <DrawioPagePicker
          top={pagePicker.top}
          left={pagePicker.left}
          pages={pagePicker.pages}
          onPick={pageId => insert(pagePicker.path, pageId)}
          onClose={() => setPagePicker(null)}
        />
      )}
      {message && createPortal(
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMessage(null)} />
          <div
            style={{ position: 'fixed', top: message.top, left: message.left, zIndex: 9999 }}
            className={`min-w-[220px] max-w-[280px] bg-surface border rounded shadow-lg px-2 py-1.5 text-xs ${
              message.tone === 'error' ? 'border-red-400/50 text-red-500' : 'border-edge text-ink-2'
            }`}
          >
            {message.text}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
