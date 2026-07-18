import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'

interface RichTextContextValue {
  activeEditor: Editor | null
  isRaw: boolean
  isActive: boolean
  toggleRaw: () => void
  activate: (editor: Editor) => void
  deactivate: () => void
}

const RichTextContext = createContext<RichTextContextValue | null>(null)

export function RichTextProvider({ children }: { children: ReactNode }) {
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [isRaw, setIsRaw] = useState(false)
  const [isActive, setIsActive] = useState(false)

  const activate = useCallback((editor: Editor) => {
    setActiveEditor(editor)
    setIsActive(true)
    // Do NOT reset isRaw here: if the user is already in raw mode on this
    // field, clearing it on every focus event (including autoFocus on the
    // textarea itself) makes raw mode permanently unreachable.
  }, [])

  const deactivate = useCallback(() => {
    setActiveEditor(null)
    setIsActive(false)
    setIsRaw(false)
  }, [])

  const toggleRaw = useCallback(() => setIsRaw(v => !v), [])

  return (
    <RichTextContext.Provider value={{ activeEditor, isRaw, isActive, toggleRaw, activate, deactivate }}>
      {children}
    </RichTextContext.Provider>
  )
}

export function useRichText() {
  return useContext(RichTextContext)
}
