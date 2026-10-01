import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface TextPromptModalProps {
  title: string
  label: string
  placeholder?: string
  confirmLabel: string
  /** Trimmed value, never empty. */
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** GH27 — single-field prompt used by the home page (Git URL, project name). Same modal shell as
 *  ConfirmCloseTabModal. Enter is handled by the form's own submit, so only Escape goes through
 *  useModalHotkeys (passing onConfirm too would fire it twice). */
export function TextPromptModal({ title, label, placeholder, confirmLabel, onConfirm, onCancel }: TextPromptModalProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const trimmed = value.trim()

  useModalHotkeys(onCancel)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-2">{label}</span>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
            autoFocus className="input-field w-full" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!trimmed} className="btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
