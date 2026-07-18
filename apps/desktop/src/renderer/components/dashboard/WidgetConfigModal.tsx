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
import { BarChart3, Hash, LineChart, PieChart, Table2, X } from 'lucide-react'
import type { QueryScope, SavedQuery, Widget, WidgetFieldMapping, WidgetSize, WidgetType } from '@polenta/types'
import { useQueryResult } from '../../hooks/useQueryResult'
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

const TYPE_OPTIONS: { value: WidgetType; label: string; icon: typeof BarChart3 }[] = [
  { value: 'bar', label: 'Barres', icon: BarChart3 },
  { value: 'pie', label: 'Camembert', icon: PieChart },
  { value: 'line', label: 'Courbe', icon: LineChart },
  { value: 'kpi', label: 'Tuile KPI', icon: Hash },
  { value: 'table', label: 'Table', icon: Table2 },
]

const SIZE_OPTIONS: { value: WidgetSize; label: string }[] = [
  { value: 'sm', label: 'Petit' },
  { value: 'md', label: 'Moyen' },
  { value: 'lg', label: 'Large' },
]

export function WidgetConfigModal({ dashboardScope, savedQueries, repoPath, workspaceDir, onSave, onClose, saving, error, initialWidget }: Props) {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-30 p-4">
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink">{initialWidget ? 'Modifier le widget' : 'Ajouter un widget'}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6">
          {/* ── Configuration ── */}
          <div className="space-y-4">
            <div>
              <label className="text-xs text-ink-3 block mb-1">Titre</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mon widget…"
                autoFocus
                className="input-field w-full"
              />
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1">Requête</label>
              <select value={queryId} onChange={(e) => setQueryId(e.target.value)} className="input-field w-full">
                <option value="">— sélectionner —</option>
                {availableQueries.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
              {dashboardScope === 'shared' && (
                <p className="text-[11px] text-ink-3 mt-1">
                  Dashboard partagé : seules les requêtes déjà partagées sont proposées.
                </p>
              )}
              {availableQueries.length === 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Aucune requête disponible{dashboardScope === 'shared' ? ' partagée' : ''}. Créez-en une dans la vue Requêtes.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1.5">Type de widget</label>
              <div className="grid grid-cols-5 gap-1.5">
                {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    title={label}
                    className={[
                      'flex flex-col items-center gap-1 py-2 rounded border text-[10px]',
                      type === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'border-edge text-ink-2 hover:bg-hover',
                    ].join(' ')}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-ink-3 block mb-1.5">Taille</label>
              <div className="flex gap-2">
                {SIZE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSize(value)}
                    className={`px-3 py-1 rounded text-xs border ${size === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'border-edge text-ink-2 hover:bg-hover'}`}
                  >
                    {label}
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
            <label className="text-xs text-ink-3 block mb-1.5">Aperçu</label>
            <div className="flex-1 min-h-[280px] border border-edge rounded-lg p-2 bg-canvas">
              {!selectedQuery ? (
                <div className="flex items-center justify-center h-full text-xs text-ink-3 italic">
                  Sélectionnez une requête pour prévisualiser.
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center h-full text-xs text-ink-3">Chargement…</div>
              ) : previewError ? (
                <div className="flex items-center justify-center h-full text-xs text-red-500 italic px-4 text-center">
                  {previewError instanceof Error ? previewError.message : "Erreur lors de l'exécution de la requête."}
                </div>
              ) : (
                <WidgetRenderer type={type} result={result ?? null} fieldMapping={fieldMapping} />
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="mx-5 mb-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary text-sm">
            Annuler
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave || saving} className="btn-primary text-sm">
            {initialWidget ? (saving ? 'Enregistrement…' : 'Enregistrer') : saving ? 'Ajout…' : 'Ajouter'}
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
  if (columns.length === 0) {
    return <p className="text-[11px] text-ink-3 italic">La requête ne renvoie aucune colonne à mapper.</p>
  }

  if (type === 'table') {
    const selected = value.columns ?? []
    return (
      <div>
        <label className="text-xs text-ink-3 block mb-1.5">Colonnes affichées (toutes si aucune sélection)</label>
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
        label="Mesure"
        value={value.measure}
        columns={columns}
        placeholder="— sélectionner —"
        onChange={(measure) => onChange({ measure })}
      />
    )
  }

  // bar / pie / line
  return (
    <div className="space-y-3">
      <ColumnSelect
        label="Catégorie"
        value={value.category}
        columns={columns}
        placeholder="— sélectionner —"
        onChange={(category) => onChange({ category })}
      />
      <ColumnSelect
        label="Mesure"
        value={value.measure}
        columns={columns}
        placeholder="— sélectionner —"
        onChange={(measure) => onChange({ measure })}
      />
      {type === 'line' && (
        <ColumnSelect
          label="Série (optionnel, multi-courbe)"
          value={value.series}
          columns={columns}
          placeholder="— aucune —"
          onChange={(series) => onChange({ series })}
        />
      )}
    </div>
  )
}
