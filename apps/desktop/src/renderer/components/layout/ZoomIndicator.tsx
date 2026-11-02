import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { zoomShortcutAction } from './zoomShortcut'

const HIDE_DELAY_MS = 1500

/**
 * GH237 — raccourcis clavier du zoom de l'interface et bulle « 110 % » affichée à chaque
 * changement (molette comprise : le main diffuse 'app:zoom-changed'). Masquée 1,5 s après le
 * dernier changement, sauf au survol.
 */
export function ZoomIndicator() {
  const { t } = useTranslation()
  // `seq` : chaque changement relance la minuterie, même à valeur égale (bornes 50 % / 300 %).
  const [shown, setShown] = useState<{ factor: number; seq: number } | null>(null)
  const [hovered, setHovered] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = zoomShortcutAction(e)
      if (!action) return
      e.preventDefault()
      void api.app.zoom(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => window.polenta.on('app:zoom-changed', (...args: unknown[]) => {
    setShown(s => ({ factor: args[0] as number, seq: (s?.seq ?? 0) + 1 }))
  }), [])

  // Minuterie de masquage relancée à chaque changement, suspendue au survol.
  useEffect(() => {
    if (shown === null || hovered) return
    hideTimer.current = setTimeout(() => setShown(null), HIDE_DELAY_MS)
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [shown, hovered])

  if (shown === null) return null
  const percent = Math.round(shown.factor * 100)
  return (
    <div className="fixed inset-x-0 top-12 z-[60] flex justify-center pointer-events-none">
      <div
        role="status"
        data-testid="zoom-indicator"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="pointer-events-auto flex items-center gap-3 bg-surface border border-edge rounded-lg shadow-xl px-3 py-1.5 text-sm text-ink"
      >
        <span><span className="sr-only">{t('zoom.label')} : </span>{percent} %</span>
        {percent !== 100 && (
          <button type="button" tabIndex={-1} className="btn-secondary btn-sm" onClick={() => void api.app.zoom('reset')}>
            {t('zoom.reset')}
          </button>
        )}
      </div>
    </div>
  )
}
