import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  repoLabel: string
  isRemoving: boolean
  error: string | null
  onConfirm: (deleteLocalFolder: boolean) => void
  onClose: () => void
}

export function RemoveDependencyModal({ repoLabel, isRemoving, error, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const [deleteLocalFolder, setDeleteLocalFolder] = useState(false)

  useModalHotkeys(onClose, () => onConfirm(deleteLocalFolder), isRemoving)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('schema.removeDependency.title', { repoLabel })}</h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-ink-2">
            <Trans
              i18nKey="schema.removeDependency.body"
              values={{ repoLabel }}
              components={{ code: <code className="text-ink-3" /> }}
            />
          </p>
          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteLocalFolder}
              onChange={e => setDeleteLocalFolder(e.target.checked)}
            />
            {t('schema.removeDependency.deleteLocalFolder')}
          </label>
          {error && <p className="text-xs text-status-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={isRemoving} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteLocalFolder)}
            disabled={isRemoving}
            className="btn-danger"
          >
            {isRemoving ? t('schema.removeDependency.removing') : t('schema.removeDependency.remove')}
          </button>
        </div>
      </div>
    </div>
  )
}
