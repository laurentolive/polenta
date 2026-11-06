import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useUpdateState } from '../../hooks/useUpdateState'

/** GH302 — écran affiché dans toutes les fenêtres pendant que l'application se ferme pour laisser
 *  place à l'installeur (état 'installing' diffusé par le main). */
export function UpdateInstallingOverlay() {
  const { t } = useTranslation()
  const state = useUpdateState()
  if (state?.status !== 'installing') return null
  return (
    <div role="alertdialog" aria-live="assertive" aria-labelledby="update-installing-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-canvas/95">
      <Loader2 size={28} className="animate-spin text-status-info-fg" />
      <p id="update-installing-title" className="text-sm font-semibold text-ink">
        {t('update.installing.title', { version: state.availableVersion ?? '' })}
      </p>
      <p className="text-xs text-ink-2 max-w-sm text-center">{t('update.installing.message')}</p>
    </div>
  )
}
