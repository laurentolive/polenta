import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Layers, Search, Tag, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useBaselines } from '../../../hooks/useBaselines'
import { useModalHotkeys } from '../../../hooks/useModalHotkeys'
import { toIntlLocale } from '../../../i18n/useLocale'
import type { BaselineRecord } from '@polenta/api-client'

// ── BaselineItem (collapsible) ────────────────────────────────────────────────

function BaselineItem({ baseline, onDelete }: { baseline: BaselineRecord; onDelete: (baseline: BaselineRecord) => void }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <li>
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-hover transition-colors group">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
          title={baseline.message || baseline.tag}
        >
          {open ? <ChevronDown size={11} className="text-ink-3 shrink-0" /> : <ChevronRight size={11} className="text-ink-3 shrink-0" />}
          <Layers size={11} className="text-ink-3 shrink-0" />
          <span className="font-mono text-ink shrink-0">{baseline.tag}</span>
          {baseline.message && <span className="text-ink-3 truncate">{baseline.message}</span>}
        </button>
        <span className="text-ink-3 font-sans shrink-0">
          {new Date(baseline.createdAt).toLocaleDateString(toIntlLocale(i18n.language))}
        </span>
        <button
          type="button"
          onClick={() => onDelete(baseline)}
          className="p-0.5 rounded text-ink-3 hover:text-status-danger hover:bg-hover transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          title={t('baselinePage.deleteBaselineTitle')}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {open && baseline.components.length > 0 && (
        <ul className="ml-5 mb-0.5">
          {baseline.components.map(comp => (
            <li key={comp.name} className="flex items-center gap-2 px-2 py-0.5 text-xs text-ink-3">
              <span className="font-mono truncate">{comp.name}</span>
              <span className="ml-auto flex items-center gap-1 shrink-0">
                <Tag size={10} className="text-status-warning" />
                <span className="font-mono text-ink">{comp.tag}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && baseline.components.length === 0 && (
        <p className="ml-5 mb-0.5 px-2 py-0.5 text-xs text-ink-3 italic">{t('baselinePage.noComponents')}</p>
      )}
    </li>
  )
}

// ── DeleteBaselineModal ─────────────────────────────────────────────────────────

function DeleteBaselineModal({
  baseline, isDeleting, error, onConfirm, onClose,
}: {
  baseline: BaselineRecord
  isDeleting: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  useModalHotkeys(onClose, onConfirm, isDeleting)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('baselinePage.deleteBaselineConfirmTitle', { tag: baseline.tag })}</h2>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-ink-2 leading-snug">
            {baseline.components.length > 0 ? (
              <Trans
                i18nKey="baselinePage.deleteBaselineBodyWithComponents"
                values={{ tag: baseline.tag, count: baseline.components.length }}
                components={{ code: <code className="text-ink-3" /> }}
              />
            ) : (
              <Trans
                i18nKey="baselinePage.deleteBaselineBody"
                values={{ tag: baseline.tag }}
                components={{ code: <code className="text-ink-3" /> }}
              />
            )}
          </p>
          {error && <p className="text-xs text-status-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="btn-danger"
          >
            {isDeleting ? t('campaignPage.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── BaselineListPanel ───────────────────────────────────────────────────────────

/** GH40 — Version panel content while `/baseline` is open: the baseline list (filter,
 *  in-place expansion of component tags, deletion), moved out of the right-hand view which
 *  now only holds the creation form. */
export function BaselineListPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { repoPath, componentRefs, baselines, isLoading } = useBaselines(projectId)

  const [deletingBaseline, setDeletingBaseline] = useState<BaselineRecord | null>(null)
  const deleteMutation = useMutation({
    mutationFn: (baseline: BaselineRecord) => api.baseline.delete(repoPath, baseline.tag, componentRefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baseline:list', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:tags'] })
      setDeletingBaseline(null)
    },
  })

  const [filterText, setFilterText] = useState('')
  const needle = filterText.trim().toLowerCase()
  const filteredBaselines = needle
    ? baselines.filter(b => b.tag.toLowerCase().includes(needle) || b.message.toLowerCase().includes(needle))
    : baselines

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-2 py-1.5 border-b border-edge-subtle">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder={t('baselinePage.filterPlaceholder')}
            className="input-field w-full text-xs py-1 pl-6"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-0.5">
        {isLoading ? (
          <p className="px-3 py-1 text-xs text-ink-3 italic">{t('common.loading')}</p>
        ) : baselines.length === 0 ? (
          <p className="px-3 py-1 text-xs text-ink-3 italic">{t('baselinePage.noBaseline')}</p>
        ) : filteredBaselines.length === 0 ? (
          <p className="px-3 py-1 text-xs text-ink-3 italic">{t('baselinePage.noBaselineMatchesFilter')}</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {filteredBaselines.map(b => (
              <BaselineItem key={b.tag} baseline={b} onDelete={setDeletingBaseline} />
            ))}
          </ul>
        )}
      </div>

      {deletingBaseline && (
        <DeleteBaselineModal
          baseline={deletingBaseline}
          isDeleting={deleteMutation.isPending}
          error={deleteMutation.error instanceof Error ? deleteMutation.error.message : null}
          onConfirm={() => deleteMutation.mutate(deletingBaseline)}
          onClose={() => { setDeletingBaseline(null); deleteMutation.reset() }}
        />
      )}
    </div>
  )
}
