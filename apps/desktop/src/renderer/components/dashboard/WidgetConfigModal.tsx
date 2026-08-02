/**
 * WidgetConfigModal — "Ajouter un widget" popup (T77 sprint 2).
 *
 * Title, query selector (proactively filtered to shared-only queries when the
 * parent dashboard is shared — T77.md § Vue Dashboard, "jamais de validation
 * d'erreur après coup"), widget type (free choice, never constrained by the query's
 * result shape), field mapping (role depends on type), predefined size, and a live
 * preview that re-executes the selected query and renders it with the current
 * mapping via the same `WidgetRenderer` used in the dashboard grid.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Hash, LineChart, PieChart, Table2, X } from 'lucide-react'
import type { QueryScope, SavedQuery, Widget, WidgetFieldMapping, WidgetSize, WidgetType } from '@polenta/types'
import { useQueryResult } from '../../hooks/useQueryResult'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { WidgetRenderer } from './widgets/WidgetRenderer'

export interface WidgetConfigResult {
  title: string
  queryId: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

interface Props {
  dashboardScope: QueryScope
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  onSave: (dto: WidgetConfigResult) => void
  onClose: () => void
  saving?: boolean
  /** Surfaced when the server-side save rejects the widget (e.g. the dashboard was
   *  shared from another tab in the meantime and now refuses a private-query widget —
   *  the client-side filter above is proactive but not a substitute for the guard in
   *  `dashboards.service.ts`). */
  error?: string | null
  /** Widget being edited — when set, the form is prefilled and labelled "Modifier"
   *  instead of "Ajouter", but reuses the same save flow (parent decides add vs update). */
  initialWidget?: Widget | null
}

const TYPE_OPTIONS: { value: WidgetType; labelKey: string; icon: typeof BarChart3 }[] = [
  { value: 'bar', labelKey: 'dashboard.widgetModal.typeBar', icon: BarChart3 },
  { value: 'pie', labelKey: 'dashboard.widgetModal.typePie', icon: PieChart },
  { value: 'line', labelKey: 'dashboard.widgetModal.typeLine', icon: LineChart },
  { value: 'kpi', labelKey: 'dashboard.widgetModal.typeKpi', icon: Hash },
  { value: 'table', labelKey: 'dashboard.widgetModal.typeTable', icon: Table2 },
]

const SIZE_OPTIONS: { value: WidgetSize; labelKey: string }[] = [
  { value: 'sm', labelKey: 'dashboard.widgetModal.sizeSmall' },
  { value: 'md', labelKey: 'dashboard.widgetModal.sizeMedium' },
  { value: 'lg', labelKey: 'dashboard.widgetModal.sizeLarge' },
]

export function WidgetConfigModal({ dashboardScope, savedQueries, repoPath, workspaceDir, onSave, onClose, saving, error, initialWidget }: Props) {
  const { t } = useTranslation()
  // Filtre proactif (pas de validation après coup) : un dashboard partagé ne propose
  // que des requêtes déjà partagées, même à l'auteur de requêtes privées.
  const availableQueries = dashboardScope === 'shared' ? savedQueries.filter((q) => q.scope === 'shared') : savedQueries

  const [title, setTitle] = useState(initialWidget?.title ?? '')
  const [queryId, setQueryId] = useState(initialWidget?.queryId ?? '')
  const [type, setType] = useState<WidgetType>(initialWidget?.type ?? 'bar')
  const [size, setSize] = useState<WidgetSize>(initialWidget?.size ?? 'md')
  const [fieldMapping, setFieldMapping] = useState<WidgetFieldMapping>(initialWidget?.fieldMapping ?? {})

  const selectedQuery = availableQueries.find((q) => q.id === queryId)
  const { data: result, isLoading, error: previewError } = useQueryResult(repoPath, workspaceDir, selectedQuery)
  const columns = result?.columns ?? []

  // Reset the mapping when the query changes — its columns may not match the
  // previous selection at all. Skipped on mount so editing an existing widget
  // doesn't wipe its own mapping before the user touches the query selector.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setFieldMapping({})
  }, [queryId])

  function updateMapping(patch: Partial<WidgetFieldMapping>) {
    setFieldMapping((prev) => ({ ...prev, ...patch }))
  }

  const mappingComplete =
    type === 'kpi'
      ? !!fieldMapping.measure
      : type === 'table'
        ? true
        : !!fieldMapping.category && !!fieldMapping.measure

  const canSave = title.trim().length > 0 && !!queryId && mappingComplete

  function handleSave() {
    if (!canSave) return
    onSave({ title: title.trim(), queryId, type, fieldMapping, size })
  }

  useModalHotkeys(onClose, handleSave, saving)

  return (
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-30 p-4">
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink">{initialWidget ? t('dashboard.widgetModal.editTitle') : t('dashboard.widgetModal.addTitle')}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6">
          {/* ── Configuration ── */}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-ink-3 block mb-1">{t('dashboard.widgetModal.titleLabel')}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('dashboard.widgetModal.titlePlaceholder')}
                autoFocus
                className="input-field w-full"
              />
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1">{t('dashboard.widgetModal.queryLabel')}</label>
              <select value={queryId} onChange={(e) => setQueryId(e.target.value)} className="input-field w-full">
                <option value="">{t('dashboard.widgetModal.selectPlaceholder')}</option>
                {availableQueries.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
              {dashboardScope === 'shared' && (
                <p className="text-[11px] text-ink-3 mt-1">
                  {t('dashboard.widgetModal.sharedDashboardHint')}
                </p>
              )}
              {availableQueries.length === 0 && (
                <p className="text-[11px] text-status-warning mt-1">
                  {dashboardScope === 'shared' ? t('dashboard.widgetModal.noSharedQueryAvailable') : t('dashboard.widgetModal.noQueryAvailable')}
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1.5">{t('dashboard.widgetModal.widgetTypeLabel')}</label>
              <div className="grid grid-cols-5 gap-1.5">
                {TYPE_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    title={t(labelKey)}
                    className={[
                      'flex flex-col items-center gap-1 py-2 rounded border text-[10px]',
                      type === value ? 'border-status-info-border bg-status-info-bg text-status-info' : 'border-edge text-ink-2 hover:bg-hover',
                    ].join(' ')}
                  >
                    <Icon size={16} />
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1.5">{t('dashboard.widgetModal.sizeLabel')}</label>
              <div className="flex gap-2">
                {SIZE_OPTIONS.map(({ value, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSize(value)}
                    className={`px-3 py-1 rounded text-xs border ${size === value ? 'border-status-info-border bg-status-info-bg text-status-info' : 'border-edge text-ink-2 hover:bg-hover'}`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {selectedQuery && (
              <FieldMappingForm type={type} columns={columns.map((c) => c.name)} value={fieldMapping} onChange={updateMapping} />
            )}
          </div>

          {/* ── Aperçu live ── */}
          <div className="flex flex-col">
            <label className="text-xs text-ink-3 block mb-1.5">{t('dashboard.widgetModal.previewLabel')}</label>
            <div className="flex-1 min-h-[280px] border border-edge rounded-lg p-2 bg-canvas">
              {!selectedQuery ? (
                <div className="flex items-center justify-center h-full text-xs text-ink-3 italic">
                  {t('dashboard.widgetModal.selectQueryToPreview')}
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center h-full text-xs text-ink-3">{t('common.loading')}</div>
              ) : previewError ? (
                <div className="flex items-center justify-center h-full text-xs text-status-danger italic px-4 text-center">
                  {previewError instanceof Error ? previewError.message : t('dashboard.widgetModal.queryExecutionError')}
                </div>
              ) : (
                <WidgetRenderer type={type} result={result ?? null} fieldMapping={fieldMapping} />
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="mx-5 mb-3 text-xs text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave || saving} className="btn-primary">
            {initialWidget ? (saving ? t('dashboard.widgetModal.saving') : t('common.save')) : saving ? t('dashboard.widgetModal.adding') : t('dashboard.widgetModal.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Shared `<select>` for a "pick a result column" mapping role — used 4x below
 *  (category / measure / series / kpi-measure), previously copy-pasted per role. */
function ColumnSelect({
  label,
  value,
  columns,
  placeholder,
  onChange,
}: {
  label: string
  value: string | undefined
  columns: string[]
  placeholder: string
  onChange: (value: string | undefined) => void
}) {
  return (
    <div>
      <label className="text-xs text-ink-3 block mb-1">{label}</label>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="input-field w-full">
        <option value="">{placeholder}</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  )
}

function FieldMappingForm({
  type,
  columns,
  value,
  onChange,
}: {
  type: WidgetType
  columns: string[]
  value: WidgetFieldMapping
  onChange: (patch: Partial<WidgetFieldMapping>) => void
}) {
  const { t } = useTranslation()
  if (columns.length === 0) {
    return <p className="text-[11px] text-ink-3 italic">{t('dashboard.widgetModal.noColumnToMap')}</p>
  }

  if (type === 'table') {
    const selected = value.columns ?? []
    return (
      <div>
        <label className="text-xs text-ink-3 block mb-1.5">{t('dashboard.widgetModal.displayedColumns')}</label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
          {columns.map((c) => (
            <label key={c} className="flex items-center gap-1 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={selected.includes(c)}
                onChange={() =>
                  onChange({ columns: selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c] })
                }
              />
              {c}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'kpi') {
    return (
      <ColumnSelect
        label={t('dashboard.widgetModal.measureLabel')}
        value={value.measure}
        columns={columns}
        placeholder={t('dashboard.widgetModal.selectPlaceholder')}
        onChange={(measure) => onChange({ measure })}
      />
    )
  }

  // bar / pie / line
  return (
    <div className="space-y-3">
      <ColumnSelect
        label={t('dashboard.widgetModal.categoryLabel')}
        value={value.category}
        columns={columns}
        placeholder={t('dashboard.widgetModal.selectPlaceholder')}
        onChange={(category) => onChange({ category })}
      />
      <ColumnSelect
        label={t('dashboard.widgetModal.measureLabel')}
        value={value.measure}
        columns={columns}
        placeholder={t('dashboard.widgetModal.selectPlaceholder')}
        onChange={(measure) => onChange({ measure })}
      />
      {(type === 'line' || type === 'bar') && (
        <ColumnSelect
          label={t('dashboard.widgetModal.seriesLabel')}
          value={value.series}
          columns={columns}
          placeholder={t('dashboard.widgetModal.noneOption')}
          onChange={(series) => onChange({ series })}
        />
      )}
      {type === 'bar' && value.series && (
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={value.stacked ?? false}
            onChange={(e) => onChange({ stacked: e.target.checked })}
          />
          {t('dashboard.widgetModal.stackedLabel')}
        </label>
      )}
    </div>
  )
}
