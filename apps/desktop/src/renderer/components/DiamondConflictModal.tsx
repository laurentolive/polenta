/**
 * DiamondConflictModal — T69 Sprint 2
 *
 * Shown when workspace:open returns { status: 'diamond-conflict' }.
 * The user must choose a unique mount name for each conflicting (url, pin) pair
 * before parsing can resume.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiamondConflict, MountOverride } from '@polenta/types'
import { useModalHotkeys } from '../hooks/useModalHotkeys'

interface Props {
  conflicts: DiamondConflict[]
  onResolve: (overrides: MountOverride[]) => void
  onCancel: () => void
}

interface PinDraft {
  url: string
  pin: string
  mountAs: string
  error?: string
}

function shortPin(pin: string): string {
  return pin.length > 12 ? pin.slice(0, 8) + '…' : pin
}

export function DiamondConflictModal({ conflicts, onResolve, onCancel }: Props) {
  const { t } = useTranslation()
  // Build a flat list of (url, pin) pairs that need names
  const initialDrafts: PinDraft[] = conflicts.flatMap(c =>
    c.pins.map(p => ({
      url: c.url,
      pin: p.pin,
      mountAs: '',
    })),
  )

  const [drafts, setDrafts] = useState<PinDraft[]>(initialDrafts)

  const updateDraft = (idx: number, value: string) => {
    setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, mountAs: value, error: undefined } : d))
  }

  const handleConfirm = () => {
    // Validate: all names filled and unique
    let hasError = false
    const names = new Set<string>()
    const validated = drafts.map(d => {
      const trimmed = d.mountAs.trim()
      if (!trimmed) {
        hasError = true
        return { ...d, mountAs: trimmed, error: t('diamondConflict.mountNameRequired') }
      }
      if (names.has(trimmed)) {
        hasError = true
        return { ...d, mountAs: trimmed, error: t('diamondConflict.nameAlreadyUsed') }
      }
      names.add(trimmed)
      return { ...d, mountAs: trimmed, error: undefined }
    })

    if (hasError) {
      setDrafts(validated)
      return
    }

    const overrides: MountOverride[] = validated.map(d => ({
      url: d.url,
      pin: d.pin,
      mountAs: d.mountAs,
    }))
    onResolve(overrides)
  }

  useModalHotkeys(onCancel, handleConfirm)

  return (
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-edge rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-edge">
          <h2 className="font-semibold text-ink text-base">{t('diamondConflict.title')}</h2>
          <p className="text-xs text-ink-3 mt-1">
            {t('diamondConflict.description')}
          </p>
        </div>

        {/* Conflicts */}
        <div className="px-5 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          {conflicts.map(conflict => (
            <div key={conflict.url} className="space-y-3">
              <p className="text-xs font-mono text-ink-2 bg-surface-2 rounded px-2 py-1 break-all">
                {conflict.url}
              </p>
              {conflict.pins.map(pinEntry => {
                const draftIdx = drafts.findIndex(
                  d => d.url === conflict.url && d.pin === pinEntry.pin,
                )
                const draft = drafts[draftIdx]
                return (
                  <div key={pinEntry.pin} className="pl-3 border-l-2 border-edge space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-medium text-ink">{t('diamondConflict.pinLabel')}</span>{' '}
                        <code className="text-xs bg-surface-2 px-1 py-0.5 rounded text-ink-2">
                          {shortPin(pinEntry.pin)}
                        </code>
                      </div>
                      <div className="text-xs text-ink-3">
                        {t('diamondConflict.requiredBy', { names: pinEntry.requiredBy.join(', ') })}
                      </div>
                    </div>
                    <div>
                      <input
                        type="text"
                        className={`input-field w-full text-sm ${draft?.error ? 'border-status-danger' : ''}`}
                        placeholder={t('diamondConflict.mountNamePlaceholder', { example: pinEntry.pin.slice(0, 4) })}
                        value={draft?.mountAs ?? ''}
                        onChange={e => updateDraft(draftIdx, e.target.value)}
                      />
                      {draft?.error && (
                        <p className="text-xs text-status-danger mt-0.5">{draft.error}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
          >
            {t('diamondConflict.applyAndRelaunch')}
          </button>
        </div>
      </div>
    </div>
  )
}
