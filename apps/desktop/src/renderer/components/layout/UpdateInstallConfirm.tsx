import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateInstallPlan } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { backdropDismiss } from '../../lib/backdropDismiss'

/**
 * GH302 — confirmation de l'installation : annonce tout ce qui va être fermé (onglets non
 * enregistrés de cette fenêtre, autres fenêtres, serveurs MCP lancés depuis cette installation),
 * puis lance l'installation. Remplace la boîte native de GH293.
 */
export function UpdateInstallConfirm({ version, dirtyTabs, onClose }: {
  version: string
  dirtyTabs: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<UpdateInstallPlan | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let alive = true
    // Détection des serveurs MCP impossible : la confirmation reste possible, sans décompte.
    api.update.prepareInstall()
      .then(p => { if (alive) setPlan(p) })
      .catch(() => { if (alive) setPlan({ mcpServers: 0, otherWindows: 0 }) })
    return () => { alive = false }
  }, [])

  const confirm = useCallback(() => {
    if (!plan || installing) return
    setInstalling(true)
    void api.update.install()
  }, [plan, installing])

  useModalHotkeys(onClose, confirm, installing)

  const items = plan ? [
    dirtyTabs > 0 && t('update.confirm.dirtyTabs', { count: dirtyTabs }),
    plan.otherWindows > 0 && t('update.confirm.otherWindows', { count: plan.otherWindows }),
    plan.mcpServers > 0 && t('update.confirm.mcpServers', { count: plan.mcpServers }),
  ].filter((x): x is string => !!x) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(installing ? undefined : onClose)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-confirm-title"
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="update-confirm-title" className="text-sm font-semibold text-ink mb-2">{t('update.confirm.title', { version })}</h2>
        <p className="text-xs text-ink-2 mb-3">{t('update.confirm.message')}</p>
        {!plan && <p className="text-xs text-ink-3 mb-3">{t('common.loading')}</p>}
        {items.length > 0 && (
          <>
            <p className="text-xs text-ink-2 mb-1">{t('update.confirm.willClose')}</p>
            <ul className="text-xs text-ink-2 list-disc pl-5 mb-3 space-y-0.5">
              {items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
        {plan && plan.mcpServers > 0 && (
          <p className="text-xs text-ink-3 mb-3">{t('update.confirm.mcpHint')}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={installing} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={confirm} disabled={!plan || installing} autoFocus
            className={dirtyTabs > 0 ? 'btn-danger' : 'btn-primary'}>
            {t('update.confirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
