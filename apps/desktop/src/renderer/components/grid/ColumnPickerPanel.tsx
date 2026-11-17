import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '../../lib/backdropDismiss'
import { toggleVisibleField } from '../system/fieldToggle'
import { ColumnChecklist, type ChecklistGroup } from './ColumnChecklist'

/**
 * GH389 — panneau 👁 Colonnes d'une grille : la coque du panneau ⚙️ de la Vue Excel (`FieldConfigModal`,
 * même position, même `layer`) autour de `ColumnChecklist`. Cocher / décocher ne déplace que cette
 * colonne (GH235) ; Réinitialiser rend les colonnes par défaut.
 */
export function ColumnPickerPanel({ groups, shown, locked, onChange, onReset, onClose, testIdPrefix, layer = 'page' }: {
  groups: ChecklistGroup[]
  /** Colonnes visibles ordonnées (préférence). */
  shown: string[]
  locked: Readonly<Record<string, string>>
  onChange: (next: string[]) => void
  onReset: () => void
  onClose: () => void
  testIdPrefix: string
  /** `modal` : au-dessus d'une modale, Échap ferme le panneau seul. */
  layer?: 'page' | 'modal'
}) {
  const { t } = useTranslation()
  const canonical = groups.flatMap(g => g.columns.map(c => c.key))

  // Échap ferme le panneau sans atteindre la grille ni une modale hôte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className={`fixed inset-0 ${layer === 'modal' ? 'z-[60]' : 'z-50'} flex items-start justify-end pt-12 pr-4`}
      {...backdropDismiss(onClose)}
      data-testid="column-picker-panel"
    >
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-4 w-72" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">{t('grid.columns')}</p>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink text-xs" aria-label={t('common.close')} data-testid="column-picker-close">✕</button>
        </div>
        <ColumnChecklist
          groups={groups}
          isChecked={key => shown.includes(key)}
          locked={locked}
          onToggle={key => { if (!(key in locked)) onChange(toggleVisibleField(shown, key, canonical)) }}
          testIdPrefix={testIdPrefix}
        />
        <button type="button" onClick={onReset} data-testid="column-picker-reset" className="mt-3 text-xs text-ink-3 hover:text-ink underline">
          {t('system.fieldConfig.reset')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
