import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type EditableObjectType,
  CATEGORY_LABEL_KEY,
  FieldsTable,
  StatusesTable,
  ConfirmDelete,
  CancelConfirmModal,
} from './objectTypeEditor'

interface Props {
  /** Repo this element belongs to (for display only — saving is handled by the caller). */
  repoLabel: string
  objectType: EditableObjectType
  /** Prefixes already used elsewhere in the workspace, excluding this element's own current prefix. */
  existingPrefixes: Set<string>
  isNew: boolean
  /** True while a save/delete is in flight — disables actions to prevent double-submit. */
  isSaving: boolean
  /** Error from the last save/delete attempt, if any. */
  saveError: string | null
  onSave: (updated: EditableObjectType) => void
  onDelete: () => void
  onClose: () => void
}

export function ElementConfigModal({ repoLabel, objectType, existingPrefixes, isNew, isSaving, saveError, onSave, onDelete, onClose }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<EditableObjectType>(objectType)
  const [prefixError, setPrefixError] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(objectType)

  const set = (patch: Partial<EditableObjectType>) => {
    setDraft(d => ({ ...d, ...patch }))
    setPrefixError(null)
  }

  const handleSave = () => {
    if (draft.prefix && existingPrefixes.has(draft.prefix)) {
      setPrefixError(t('schema.elementConfig.prefixInUse', { prefix: draft.prefix }))
      return
    }
    onSave(draft)
  }

  const requestClose = () => {
    // Same "confirm if dirty" rule for new and existing elements alike — a new
    // element the user has actually filled in is real work too. Only an
    // untouched (still empty) new scaffold closes without asking, since the
    // caller deletes it on close (nothing to lose).
    if (isDirty) setShowCancelConfirm(true)
    else onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCancelConfirm) { setShowCancelConfirm(false); return }
        requestClose()
        return
      }
      if (e.key !== 'Enter' || showCancelConfirm || isSaving) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || target?.isContentEditable) return
      handleSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCancelConfirm, isSaving, handleSave, requestClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={requestClose}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge">
          <span className="text-xs px-1.5 py-0.5 rounded bg-hover text-ink-3">{t(CATEGORY_LABEL_KEY[draft.category])}</span>
          <h2 className="text-sm font-semibold text-ink flex-1">
            {isNew ? t('schema.elementConfig.newElement') : (draft.label || draft.name || t('schema.elementConfig.element'))}
          </h2>
          <span className="text-xs text-ink-3">{repoLabel}</span>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {draft.category === 'test' && (
            <p className="text-xs text-ink-3 bg-hover rounded px-2 py-1.5 mb-3">
              {t('schema.elementConfig.testStepsHint')}
            </p>
          )}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">{t('schema.elementConfig.nameId')}</label>
              <input value={draft.name} onChange={e => set({ name: e.target.value })} className="input-field w-full font-mono text-xs py-1" placeholder={t('schema.elementConfig.namePlaceholder')} />
            </div>
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">{t('schema.addDependency.displayLabel')}</label>
              <input value={draft.label} onChange={e => set({ label: e.target.value })} className="input-field w-full text-xs py-1" placeholder={t('schema.elementConfig.labelPlaceholder')} />
            </div>
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">{t('schema.elementConfig.prefixId')}</label>
              <input value={draft.prefix} onChange={e => set({ prefix: e.target.value })} className="input-field w-full font-mono text-xs py-1" placeholder="REQ" />
            </div>
            <div>
              <label className="block text-xs text-ink-2 mb-0.5">{t('schema.elementConfig.color')}</label>
              <input value={draft.color} onChange={e => set({ color: e.target.value })} className="input-field w-full text-xs py-1" placeholder="#3b82f6" />
            </div>
          </div>
          {prefixError && <p className="text-xs text-status-danger mb-3">{prefixError}</p>}
          {saveError && <p className="text-xs text-status-danger mb-3">{saveError}</p>}
          <FieldsTable fields={draft.fields} onChange={fields => set({ fields })} />
          {draft.category !== 'campaign' && (
            <StatusesTable statuses={draft.statuses} onChange={statuses => set({ statuses })} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-edge">
          <div>
            {!isNew && (
              <ConfirmDelete
                onConfirm={onDelete}
                disabled={isSaving}
                label={t('common.delete')}
                className="text-sm text-status-danger hover:opacity-80 transition-colors disabled:opacity-50"
              />
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} disabled={isSaving} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleSave} disabled={isSaving || (!isDirty && !isNew)} className="btn-primary">
              {isSaving ? t('schema.elementConfig.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {showCancelConfirm && (
        <CancelConfirmModal onConfirm={onClose} onClose={() => setShowCancelConfirm(false)} />
      )}
    </div>
  )
}
