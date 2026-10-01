import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownCircle } from 'lucide-react'
import { api } from '../../api'
import { useUpdateState } from '../../hooks/useUpdateState'
import { useTabs } from '../../contexts/TabsContext'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

/** GH26 — badge discret en bas de l'ActivityBar, visible seulement quand une mise à jour est
 *  téléchargée et prête. Jamais de popup : l'utilisateur ouvre le popover s'il le souhaite. */
export function UpdateBadge() {
  const { t } = useTranslation()
  const state = useUpdateState()
  const { dirtyTabIds } = useTabs()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const close = useCallback(() => { setOpen(false); setConfirming(false) }, [])
  useModalHotkeys(close, undefined, !open)

  if (state?.status !== 'ready' || !state.availableVersion) return null
  const version = state.availableVersion

  function handleInstall() {
    // Les onglets dirty tiennent des saisies en mémoire, non écrites sur disque.
    if (dirtyTabIds.size > 0 && !confirming) {
      setConfirming(true)
      return
    }
    void api.update.install()
  }

  return (
    <div className="relative mt-auto">
      <button
        type="button"
        title={t('update.badge.title', { version })}
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-12 h-12 text-activity-fg hover:text-activity-fg-hover hover:bg-activity-bg-active transition-colors"
      >
        <ArrowDownCircle size={20} />
        <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-status-info-solid" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            className="absolute left-full bottom-0 ml-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-4 w-72"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-ink mb-1">{t('update.popover.title')}</p>
            <p className="text-xs text-ink-2 mb-3">
              {t('update.popover.versions', { current: state.currentVersion, available: version })}
            </p>
            {state.releaseUrl && (
              <button
                type="button"
                onClick={() => void api.app.openReleasePage(state.releaseUrl!)}
                className="text-xs text-status-info-fg hover:underline mb-4 block"
              >
                {t('update.popover.releaseNotes')}
              </button>
            )}
            {confirming && (
              <p className="text-xs text-status-warning mb-3">{t('update.popover.dirtyWarning')}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-secondary">
                {t('update.popover.later')}
              </button>
              <button type="button" onClick={handleInstall} className={confirming ? 'btn-danger' : 'btn-primary'}>
                {confirming ? t('update.popover.installAnyway') : t('update.popover.install')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
