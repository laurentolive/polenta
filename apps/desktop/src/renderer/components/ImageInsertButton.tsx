import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { ImagePlus } from 'lucide-react'
import { api } from '../api'

interface Props {
  editor: Editor | null | undefined
  repoPath?: string
  disabled?: boolean
  className?: string
}

const MESSAGE_AUTO_DISMISS_MS = 5000

// Bouton partagé "Insérer une image", utilisé à la fois par la toolbar
// contextuelle (RichTextToolbar) et la toolbar inline standalone
// (RichTextField sans RichTextContext) — mirroir de DrawioInsertButton.tsx,
// en plus simple (pas de sélection de page/node-id, une image n'en a pas),
// mais avec le même retour utilisateur en cas d'erreur ou de copie (cf. revue
// de code T76 : un échec de copie ne doit pas passer inaperçu).
export function ImageInsertButton({ editor, repoPath, disabled, className }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Empêche un double-clic de superposer deux dialogues natifs de sélection de
  // fichier (et donc potentiellement deux insertions) pendant l'aller-retour IPC.
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error'; top: number; left: number } | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  const showMessage = (anchor: { top: number; left: number }, text: string, tone: 'info' | 'error') => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    setMessage({ text, tone, top: anchor.top, left: anchor.left })
    dismissTimerRef.current = setTimeout(() => setMessage(null), MESSAGE_AUTO_DISMISS_MS)
  }

  const handleClick = async () => {
    if (!repoPath || !editor || pending) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const anchor = { top: rect.bottom + 2, left: rect.left }
    setPending(true)
    setMessage(null)
    try {
      const picked = await api.image.pickFile(repoPath)
      if (picked.status === 'canceled') return
      if (picked.status === 'error') {
        showMessage(anchor, picked.message, 'error')
        return
      }
      if (picked.copied) {
        showMessage(anchor, `Fichier copié dans ${picked.path}`, 'info')
      }
      editor.chain().focus().setImage({ src: picked.path }).run()
    } catch (err) {
      showMessage(anchor, err instanceof Error ? err.message : "Erreur lors de l'insertion de l'image.", 'error')
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
        title={repoPath ? 'Insérer une image (fichier)' : 'Insérer une image (contexte repo indisponible)'}
        className={className}
      ><ImagePlus size={13} /></button>
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
