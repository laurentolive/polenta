import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDownCircle, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { useUpdateState } from '../../hooks/useUpdateState'
import { useAdminMe } from '../../hooks/useAdmin'
import { useTabs } from '../../contexts/TabsContext'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { platform } from '../../platform'
import { UpdateInstallConfirm } from './UpdateInstallConfirm'
import { WebReleaseUpdate, WebUpdateProgress } from './WebReleaseUpdate'
import { updateView, type UpdateView } from './updateView'
import { backdropDismiss } from '../../lib/backdropDismiss'

function BadgeIcon({ view }: { view: UpdateView }) {
  switch (view.kind) {
    case 'downloading': return <Loader2 size={20} className="animate-spin" />
    case 'error': return <AlertTriangle size={20} className="text-status-warning" />
    case 'reload': return <RefreshCw size={20} />
    case 'ready': return <ArrowDownCircle size={20} className="text-status-success-solid" />
    default: return <ArrowDownCircle size={20} />
  }
}

/**
 * GH26 — bouton discret en bas de l'ActivityBar. GH302 — visible dès la détection d'une nouvelle
 * version, avec un aspect par état (disponible, téléchargement, prête, erreur ; web : recharger,
 * release pour l'administrateur). Jamais de popup imposé : l'utilisateur ouvre le popover.
 */
export function UpdateBadge() {
  const { t } = useTranslation()
  const state = useUpdateState()
  const { me } = useAdminMe()
  const { dirtyTabIds } = useTabs()
  const [open, setOpen] = useState(false)
  const [confirmingInstall, setConfirmingInstall] = useState(false)
  const [confirmingReload, setConfirmingReload] = useState(false)
  // GH305 — travail `web.update` lancé depuis le popover : suivi gardé quand le popover se ferme.
  const [webJobId, setWebJobId] = useState<string | null>(null)

  const close = useCallback(() => { setOpen(false); setConfirmingReload(false) }, [])
  useModalHotkeys(close, undefined, !open || confirmingInstall)

  const view = updateView(state, platform === 'web', !!me)
  if (!view || !state) return null

  const title = {
    available: t('update.badge.available', { version: view.version }),
    downloading: t('update.badge.downloading', { version: view.version, progress: view.kind === 'downloading' ? view.progress : 0 }),
    ready: t('update.badge.ready', { version: view.version }),
    error: t('update.badge.error', { version: view.version }),
    reload: t('update.badge.reload', { version: view.version }),
    release: t('update.badge.available', { version: view.version }),
  }[view.kind]

  function handleReload() {
    if (dirtyTabIds.size > 0 && !confirmingReload) {
      setConfirmingReload(true)
      return
    }
    location.reload()
  }

  const releaseNotes = state.releaseUrl && view.kind !== 'reload' && (
    platform === 'web'
      ? <a href={state.releaseUrl} target="_blank" rel="noreferrer" className="text-xs text-status-info hover:underline mb-3 block">{t('update.popover.releaseNotes')}</a>
      : <button type="button" onClick={() => void api.app.openReleasePage(state.releaseUrl!)} className="text-xs text-status-info hover:underline mb-3 block">{t('update.popover.releaseNotes')}</button>
  )

  return (
    <div className="relative mt-auto">
      <button
        type="button"
        title={title}
        aria-label={title}
        data-update-state={view.kind}
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-12 h-12 text-activity-fg hover:text-activity-fg-hover hover:bg-activity-bg-active transition-colors"
      >
        <BadgeIcon view={view} />
        {(view.kind === 'available' || view.kind === 'ready' || view.kind === 'reload' || view.kind === 'release') && (
          <span className={`absolute top-3 right-3 w-1.5 h-1.5 rounded-full ${view.kind === 'ready' ? 'bg-status-success-solid' : 'bg-status-info-solid'}`} />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" {...backdropDismiss(close)} />
          <div
            role="dialog"
            aria-label={title}
            className="absolute left-full bottom-0 ml-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-4 w-72"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-ink mb-1">{t(`update.popover.title.${view.kind}`, { version: view.version })}</p>
            {view.kind !== 'reload' && (
              <p className="text-xs text-ink-2 mb-3">
                {t('update.popover.versions', { current: state.currentVersion, available: view.version })}
              </p>
            )}
            {releaseNotes}

            {view.kind === 'downloading' && (
              <div className="mb-3" role="progressbar" aria-valuenow={view.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-1.5 rounded bg-hover overflow-hidden">
                  <div className="h-full bg-status-info-solid transition-all" style={{ width: `${view.progress}%` }} />
                </div>
                <p className="text-xs text-ink-3 mt-1">{t('update.popover.progress', { progress: view.progress })}</p>
              </div>
            )}
            {view.kind === 'available' && view.managed && (
              <p className="text-xs text-ink-2 mb-3">{t('update.popover.managed')}</p>
            )}
            {view.kind === 'error' && (
              <p className="text-xs text-status-warning mb-3">{t('update.popover.error')}</p>
            )}
            {view.kind === 'reload' && (
              <p className="text-xs text-ink-2 mb-3">{t('update.popover.reloadMessage', { current: state.currentVersion })}</p>
            )}
            {view.kind === 'reload' && webJobId && <WebUpdateProgress jobId={webJobId} />}
            {view.kind === 'release' && me?.instance && (
              <WebReleaseUpdate
                version={view.version}
                instance={me.instance}
                dirtyTabs={dirtyTabIds.size}
                jobId={webJobId}
                onLaunched={setWebJobId}
              />
            )}
            {confirmingReload && (
              <p className="text-xs text-status-warning mb-3">{t('update.popover.dirtyReloadWarning')}</p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-secondary">
                {t(view.kind === 'release' || (view.kind === 'available' && view.managed) || view.kind === 'downloading' ? 'common.close' : 'update.popover.later')}
              </button>
              {view.kind === 'available' && !view.managed && (
                <button type="button" onClick={() => void api.update.download()} className="btn-primary">{t('update.popover.download')}</button>
              )}
              {view.kind === 'error' && (
                <button type="button" onClick={() => void api.update.download()} className="btn-primary">{t('update.popover.retry')}</button>
              )}
              {view.kind === 'ready' && (
                <button type="button" onClick={() => { setOpen(false); setConfirmingInstall(true) }} className="btn-primary">{t('update.popover.install')}</button>
              )}
              {view.kind === 'reload' && (
                <button type="button" onClick={handleReload} className={confirmingReload ? 'btn-danger' : 'btn-primary'}>
                  {t(confirmingReload ? 'update.popover.reloadAnyway' : 'update.popover.reload')}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {confirmingInstall && view.kind === 'ready' && (
        <UpdateInstallConfirm version={view.version} dirtyTabs={dirtyTabIds.size} onClose={() => setConfirmingInstall(false)} />
      )}
    </div>
  )
}
