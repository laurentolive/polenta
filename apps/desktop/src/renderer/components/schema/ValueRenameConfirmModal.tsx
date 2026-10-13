import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { ValueRename, ValueRenamePreview } from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  previews: ValueRenamePreview[]
  /** Libellé affiché d'un champ (nom courant) — repli sur le nom. */
  fieldLabel: (field: string) => string
  onConfirm: (chosen: ValueRename[]) => void
  onCancel: () => void
}

/**
 * GH82 — confirmation des renommages de statut / valeur d'enum détectés à l'enregistrement d'un
 * type, **avant** l'écriture du schéma : une ligne par renommage, décochable, avec le nombre d'objets
 * concernés et un avertissement quand la nouvelle valeur est déjà portée (les deux seront confondues).
 * Annuler n'enregistre rien.
 */
export function ValueRenameConfirmModal({ previews, fieldLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<boolean[]>(() => previews.map(() => true))
  const confirm = () => onConfirm(previews.filter((_, i) => checked[i]).map(p => p.rename))
  useModalHotkeys(onCancel, confirm)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={t('schema.valueRename.title')}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink mb-1">{t('schema.valueRename.title')}</h2>
        <p className="text-xs text-ink-2 mb-3">{t('schema.valueRename.intro')}</p>
        <ul className="space-y-2 mb-3">
          {previews.map((p, i) => {
            const { rename } = p
            const where = rename.target.kind === 'status'
              ? t('schema.valueRename.status')
              : t('schema.valueRename.field', { field: fieldLabel(rename.target.field) })
            return (
              <li key={i} className="text-xs">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={e => setChecked(c => c.map((v, j) => (j === i ? e.target.checked : v)))}
                    className="mt-0.5 h-3 w-3 accent-ink"
                  />
                  <span className="flex-1">
                    <span className="text-ink-2">{where} : </span>
                    <code className="font-mono">{rename.from}</code> → <code className="font-mono">{rename.to}</code>
                    <span className="block text-ink-3">
                      {p.withOld < 0 ? t('schema.valueRename.objectsUnknown') : t('schema.valueRename.objects', { count: p.withOld })}
                    </span>
                    {p.withNew > 0 && (
                      <span className="flex items-center gap-1 text-status-warning">
                        <AlertTriangle size={12} className="shrink-0" />
                        {t('schema.valueRename.collision', { count: p.withNew, value: rename.to })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-ink-3 mb-5">{t('schema.valueRename.suiviNote')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={confirm} autoFocus className="btn-primary">{t('schema.valueRename.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
