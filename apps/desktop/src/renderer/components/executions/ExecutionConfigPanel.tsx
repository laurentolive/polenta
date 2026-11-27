import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNonModalDismiss } from '../../lib/nonModalPanel'
import { toggleVisibleField } from '../system/fieldToggle'
import { ColumnChecklist, type ChecklistGroup } from '../grid/ColumnChecklist'
import type { GridPrefs } from '../grid/useGridPrefs'

export type ExecutionConfigTab = 'excel' | 'word' | 'popup'

export interface ExecutionConfigTabDef {
  tab: ExecutionConfigTab
  groups: ChecklistGroup[]
  prefs: GridPrefs
  /** Clé `FieldVisibilityPref` de l'onglet (`runExcel`, `runWord`, `runPopup`). */
  prefKey: string
}

const TAB_LABEL_KEY: Record<ExecutionConfigTab, string> = {
  excel: 'executionsView.config.excel',
  word: 'executionsView.config.word',
  popup: 'executionsView.config.popup',
}

/**
 * GH400 — panneau 👁 de la vue Exécutions (specs/GH400-design.md §8) : coque du panneau de colonnes
 * des grilles, un onglet par réglage du type de test affiché. Cocher / décocher ne déplace que cette
 * colonne (GH235). « Réinitialiser » retire la clé de l'onglet — pas la vue enregistrée du type
 * (`activeView`, GH203), qui appartient à la vue Tests.
 */
export function ExecutionConfigPanel({ tabs, initialTab, onClose }: {
  tabs: ExecutionConfigTabDef[]
  initialTab: ExecutionConfigTab
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ExecutionConfigTab>(initialTab)
  const current = tabs.find(d => d.tab === tab) ?? tabs[0]
  const canonical = current.groups.flatMap(g => g.columns.map(c => c.key))
  const shown = current.prefs.columns
  // La case suit le clic tout de suite ; la préférence (cache partagé) la rattrape.
  const [checked, setChecked] = useState(shown)
  useEffect(() => setChecked(shown), [shown, tab])

  // Échap ferme le panneau sans atteindre la grille.
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

  // GH465 — panneau non modal : la vue derrière reste utilisable (barres de défilement, molette).
  const cardRef = useRef<HTMLDivElement>(null)
  useNonModalDismiss(cardRef, onClose)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-end pt-12 pr-4 pointer-events-none" data-testid="execution-config-panel">
      <div ref={cardRef} className="pointer-events-auto bg-surface border border-edge rounded-lg shadow-xl p-4 w-80 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">{t('grid.columns')}</p>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink text-xs" aria-label={t('common.close')} data-testid="execution-config-close">✕</button>
        </div>
        <div className="flex gap-1 mb-3 border-b border-edge" role="tablist">
          {tabs.map(d => (
            <button key={d.tab} type="button" role="tab" aria-selected={d.tab === tab}
              onClick={() => setTab(d.tab)}
              data-testid={`execution-config-tab-${d.tab}`}
              className={`px-2 py-1 text-xs -mb-px border-b-2 ${d.tab === tab ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
              {t(TAB_LABEL_KEY[d.tab])}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto min-h-0">
          <ColumnChecklist
            groups={current.groups}
            isChecked={key => checked.includes(key)}
            locked={{}}
            onToggle={key => {
              const next = toggleVisibleField(checked, key, canonical)
              setChecked(next)
              current.prefs.setColumns(next)
            }}
            testIdPrefix={`execution-config-${tab}`}
          />
        </div>
        <button type="button" onClick={() => void current.prefs.patch({ [current.prefKey]: null })}
          data-testid="execution-config-reset" className="mt-3 self-start text-xs text-ink-3 hover:text-ink underline">
          {t('system.fieldConfig.reset')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
