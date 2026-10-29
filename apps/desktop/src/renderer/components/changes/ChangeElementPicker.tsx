import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { api } from '../../api'
import { useProjectSchema, getObjectTypeRefs } from '../../hooks/useProjectSchema'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { TestPickerGrid } from '../campaign/TestPickerGrid'
import { NO_FILTER_OPTIONS, type FilterOptions } from '../../lib/textFilter'

/**
 * GH198 — sélecteur d'éléments d'un change (« à modifier », « impactés ») : même grille que le
 * sélecteur de tests d'une campagne (Vue Excel en mode sélection, filtres de colonne, colonnes ⚙️),
 * un type d'exigence ou de test à la fois, éléments du repo du change (Q3). Les éléments déjà listés
 * ne sont pas proposés.
 */
export function ChangeElementPicker({ repoPath, workspaceDir, title, excluded, onAdd, onClose }: {
  repoPath: string
  workspaceDir: string
  title: string
  excluded: ReadonlySet<string>
  onAdd: (ids: string[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data: schema } = useProjectSchema(repoPath)
  const typeRefs = useMemo(() => [
    ...getObjectTypeRefs(schema, 'requirement').map(r => ({ ...r, category: 'requirement' as const })),
    ...getObjectTypeRefs(schema, 'test').map(r => ({ ...r, category: 'test' as const })),
  ], [schema])
  const { data: identityLogin, isPending: identityPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identityLogin ?? 'local'
  const { data: reqs = [] } = useQuery({ queryKey: ['requirements', repoPath], queryFn: () => api.requirements.list(repoPath), enabled: !!repoPath })
  const { data: tests = [] } = useQuery({ queryKey: ['tests', repoPath], queryFn: () => api.tests.list(repoPath), enabled: !!repoPath })

  const [chosenTypeRef, setChosenTypeRef] = useState<string | null>(null)
  const typeRef = chosenTypeRef ?? typeRefs[0]?.ref
  const currentType = typeRefs.find(r => r.ref === typeRef)
  const [filter, setFilter] = useState('')
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(NO_FILTER_OPTIONS)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const closeColumns = useCallback(() => setColumnsOpen(false), [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [displayed, setDisplayed] = useState<string[]>([])

  const candidates = useMemo(() => {
    const pool = currentType?.category === 'test' ? tests : reqs
    return pool.filter(o => o.objectTypeRef === typeRef && !excluded.has(o.id))
  }, [currentType, tests, reqs, typeRef, excluded])
  const selection = useMemo(() => ({ selected, onChange: setSelected, onDisplayedChange: setDisplayed }), [selected])
  const displayedSet = new Set(candidates.length > 0 ? displayed : [])
  const hiddenCount = [...selected].filter(id => !displayedSet.has(id)).length

  const confirm = () => { if (selected.size > 0) onAdd([...selected]) }
  useModalHotkeys(onClose, undefined, columnsOpen)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div role="dialog" aria-label={title} className="bg-surface border border-edge rounded-lg shadow-xl w-[95vw] h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
        </div>
        {typeRefs.length === 0 ? (
          <p className="flex-1 p-4 text-xs text-ink-3 italic">{t('changes.pickNone')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-edge">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                {t('changes.type')}
                <select
                  value={typeRef}
                  onChange={e => { setChosenTypeRef(e.target.value); setFilter('') }}
                  className="input-field text-xs"
                  data-testid="change-pick-type"
                >
                  {typeRefs.map(r => (
                    <option key={r.ref} value={r.ref}>{t(r.category === 'requirement' ? 'changes.requirement' : 'changes.test')} · {r.label}</option>
                  ))}
                </select>
              </label>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t('common.filterPlaceholder')}
                className="input-field text-xs flex-1 min-w-[12rem]"
                data-testid="change-pick-filter"
              />
              <FilterOptionsToggle options={filterOptions} onChange={setFilterOptions} />
              {currentType && !identityPending && candidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setColumnsOpen(v => !v)}
                  title={t('system.fieldConfig.configureColumns')}
                  className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
                  data-testid="picker-columns-button"
                >
                  <Settings size={14} />
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {currentType && !identityPending && (
                candidates.length === 0 ? (
                  <p className="p-4 text-xs text-ink-3 italic">{t('changes.pickNone')}</p>
                ) : (
                  <TestPickerGrid
                    repoPath={repoPath}
                    typeRef={currentType.ref}
                    typeDef={currentType.typeDef}
                    tests={candidates}
                    category={currentType.category}
                    username={username}
                    workspaceDir={workspaceDir}
                    filter={filter}
                    filterOptions={filterOptions}
                    selection={selection}
                    columnsOpen={columnsOpen}
                    onColumnsClose={closeColumns}
                  />
                )
              )}
            </div>
          </>
        )}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-edge">
          <p className="text-xs text-ink-2">
            {t('campaignPage.picker.selected', { count: selected.size })}
            {hiddenCount > 0 && t('campaignPage.picker.hiddenSuffix', { count: hiddenCount })}
          </p>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-status-info hover:opacity-80">
              {t('campaignPage.picker.clearSelection')}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
            <button type="button" onClick={confirm} disabled={selected.size === 0} className="btn-primary-sm" data-testid="change-pick-confirm">
              {t('changes.addSelected')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
