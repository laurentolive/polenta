import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * GH63 — confirmation d'une opération à risque (design §5.3) : `expected` défini = saisie exacte du
 * nom (instance, hôte) ; sinon simple confirmation. Le service revérifie la valeur.
 */
export function ConfirmByName({
  title,
  message,
  expected,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  title: string
  message: string
  expected?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (typed: string | true) => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const ok = expected === undefined || typed === expected

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="presentation" onKeyDown={e => e.key === 'Escape' && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title" className="bg-surface border border-edge rounded-xl shadow-lg w-full max-w-md p-5 space-y-4">
        <h2 id="admin-confirm-title" className="text-base font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-2 whitespace-pre-line">{message}</p>
        {children}
        {expected !== undefined && (
          <label className="block text-sm text-ink">
            {t('admin.confirm.typeName', { name: expected })}
            <input
              ref={inputRef}
              className="input-field mt-1 w-full font-mono"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              aria-label={t('admin.confirm.typeName', { name: expected })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={!ok}
            onClick={() => onConfirm(expected === undefined ? true : typed)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
