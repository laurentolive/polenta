import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeTransitionNotices, type TransitionNotice } from '../../lib/transitionNotices'

const AUTO_CLOSE_MS = 10_000

/**
 * GH206 — notifications des contraintes de transition, en bas à droite : passage notifié (sans
 * confirmation, fermeture automatique) ou refus (reste affiché jusqu'à la fermeture).
 */
export function TransitionNoticeHost() {
  const { t } = useTranslation()
  const [notices, setNotices] = useState<TransitionNotice[]>([])
  const close = (id: number) => setNotices(list => list.filter(n => n.id !== id))

  useEffect(() => subscribeTransitionNotices(notice => {
    setNotices(list => [...list.slice(-2), notice])
    if (notice.kind === 'warning') setTimeout(() => close(notice.id), AUTO_CLOSE_MS)
  }), [])

  if (notices.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" data-testid="transition-notices">
      {notices.map(n => (
        <div
          key={n.id}
          role={n.kind === 'blocked' ? 'alert' : 'status'}
          data-testid={`transition-notice-${n.kind}`}
          className={`rounded border px-3 py-2 text-xs shadow ${n.kind === 'blocked'
            ? 'border-status-danger bg-status-danger-bg text-status-danger'
            : 'border-status-warning bg-status-warning-bg text-status-warning'}`}
        >
          <div className="flex items-start gap-2">
            <p className="font-medium flex-1">
              {t(n.kind === 'blocked' ? 'transitions.notice.blocked' : 'transitions.notice.warning', { id: n.objectId ?? '' })}
            </p>
            <button type="button" onClick={() => close(n.id)} className="opacity-70 hover:opacity-100" aria-label={t('common.close')}>×</button>
          </div>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {n.messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}
