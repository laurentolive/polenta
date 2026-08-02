import { useEffect } from 'react'

/**
 * Universal modal shortcuts: Escape triggers cancel/close, Enter triggers the default
 * (primary) action. Ignored while `disabled` (e.g. a save/delete in flight — matches the
 * buttons themselves being disabled), and Enter is skipped when focus is on a <textarea>
 * (multi-line input where Enter must insert a newline), a <button> (its own native Enter
 * behavior already applies — don't override whichever button has focus), or a
 * contentEditable region (richtext editors handle Enter themselves).
 */
export function useModalHotkeys(onCancel: () => void, onConfirm?: () => void, disabled = false) {
  useEffect(() => {
    if (disabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
        return
      }
      if (e.key !== 'Enter' || !onConfirm) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || target?.isContentEditable) return
      onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel, onConfirm, disabled])
}
