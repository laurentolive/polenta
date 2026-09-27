import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FilePen, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useSelectedRepo } from '../../../contexts/SelectedRepoContext'
import { useImpactAnalysis, LOCAL_IMPACT_ANALYSIS_ID } from '../../../contexts/ImpactAnalysisContext'
import { useLocalImpactAnalysis } from '../../../hooks/useLocalImpactAnalysis'
import { useModalHotkeys } from '../../../hooks/useModalHotkeys'
import type { BaselineRecord } from '@polenta/api-client'
import type { ImpactAnalysisSummary } from '@polenta/types'

interface Props {
  projectId: string
}

// ── BaselineCombobox ─────────────────────────────────────────────────────────

interface BaselineComboboxProps {
  baselines: BaselineRecord[]
  value: string | undefined
  placeholder: string
  onChange: (tag: string) => void
  onCreateNew: () => void
}

function BaselineCombobox({ baselines, value, placeholder, onChange, onCreateNew }: BaselineComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-2 py-1 text-xs border border-edge rounded bg-surface text-ink flex items-center justify-between gap-1 hover:bg-hover transition-colors"
      >
        <span className="truncate font-mono">{value || placeholder}</span>
        <span className="text-ink-3 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg max-h-64 overflow-y-auto">
          {baselines.length === 0 && (
            <p className="text-xs text-ink-3 italic px-3 py-2">{t('sidebar.version.noBaseline')}</p>
          )}
          {baselines.map((b) => (
            <button
              key={b.tag}
              type="button"
              onClick={() => { onChange(b.tag); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-ink hover:bg-hover transition-colors flex items-center justify-between gap-2"
            >
              <span className="truncate">{b.tag}</span>
              <span className="text-ink-3 shrink-0">{new Date(b.createdAt).toLocaleDateString('fr-FR')}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { onCreateNew(); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-prim hover:bg-hover transition-colors border-t border-edge-subtle"
          >
            + {t('sidebar.version.createBaselineHint')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── VersionImpactSelector ────────────────────────────────────────────────────
// Body shown in place of the repo tree when the Version sidebar is scoped to the
// `/impact-analysis` route: baseline picking, creation and the list of existing analyses
// live here — and stay visible even once an analysis is selected (the selected row is just
// highlighted) so switching between analyses doesn't require navigating back to the list
// first. The impacted-requirements tree itself is shown large in the main content, which
// reads which analysis is active from ImpactAnalysisContext.
export function VersionImpactSelector({ projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedRepoPath } = useSelectedRepo()
  const { activeAnalysisId, setActiveAnalysisId } = useImpactAnalysis()
  const repoPath = selectedRepoPath

  const [fromTag, setFromTag] = useState<string | undefined>(undefined)
  const [toTag, setToTag] = useState<string | undefined>(undefined)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; label: string } | null>(null)

  const { data: baselines = [] } = useQuery({
    queryKey: ['baseline:list', repoPath],
    queryFn: () => api.baseline.list(repoPath),
    enabled: !!repoPath,
  })

  const { data: analyses = [] } = useQuery({
    queryKey: ['impact-analysis:list', repoPath],
    queryFn: () => api.impactAnalysis.list(repoPath),
    enabled: !!repoPath,
  })

  // T175 — analyse live des modifications locales : entrée en tête de liste tant qu'au moins un
  // élément diffère de HEAD, sélectionnée automatiquement une seule fois par ouverture de la vue
  // (montage du panneau) si aucune analyse n'est active — un clic qui la désélectionne ensuite
  // n'est pas annulé au recalcul suivant.
  const { data: localAnalysis } = useLocalImpactAnalysis(projectId)
  const localCount = localAnalysis?.changedRequirements.length ?? 0
  const isLocalActive = activeAnalysisId === LOCAL_IMPACT_ANALYSIS_ID
  const autoSelectedRef = useRef(false)

  useEffect(() => {
    if (autoSelectedRef.current || !localAnalysis) return
    autoSelectedRef.current = true
    if (activeAnalysisId === null && localCount > 0) setActiveAnalysisId(LOCAL_IMPACT_ANALYSIS_ID)
  }, [localAnalysis, localCount, activeAnalysisId, setActiveAnalysisId])

  useEffect(() => {
    if (isLocalActive && localAnalysis && localCount === 0) setActiveAnalysisId(null)
  }, [isLocalActive, localAnalysis, localCount, setActiveAnalysisId])

  const createMutation = useMutation({
    mutationFn: () => api.impactAnalysis.create(repoPath, { fromBaselineTag: fromTag!, toBaselineTag: toTag! }),
    onSuccess: (analysis) => {
      qc.invalidateQueries({ queryKey: ['impact-analysis:list', repoPath] })
      setActiveAnalysisId(analysis.id)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.impactAnalysis.delete(repoPath, id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['impact-analysis:list', repoPath] })
      if (activeAnalysisId === id) backToSelection()
    },
  })

  // Les arbres d'impact sont construits à partir du snapshot de `toBaseline` uniquement — si
  // l'utilisateur choisit la baseline la plus récente comme "from", les liens qui n'existent pas
  // encore côté "to" (plus ancien) sont invisibles et l'analyse paraît vide. On force donc l'ordre
  // chronologique quel que soit le combobox où l'utilisateur clique.
  function baselineTimestamp(tag: string | undefined): number {
    if (!tag) return 0
    const createdAt = baselines.find((b) => b.tag === tag)?.createdAt
    return createdAt ? new Date(createdAt).getTime() : 0
  }

  function setOrderedTags(a: string | undefined, b: string | undefined) {
    if (a && b && baselineTimestamp(a) > baselineTimestamp(b)) {
      setFromTag(b)
      setToTag(a)
    } else {
      setFromTag(a)
      setToTag(b)
    }
  }

  function goToCreateBaseline() {
    navigate({ to: '/baseline', search: { projectId } })
  }

  function openAnalysis(summary: ImpactAnalysisSummary) {
    setActiveAnalysisId(activeAnalysisId === summary.id ? null : summary.id)
  }

  function backToSelection() {
    setActiveAnalysisId(null)
    setFromTag(undefined)
    setToTag(undefined)
  }

  function deleteAnalysis(id: string, label: string) {
    setDeleteConfirm({ id, label })
  }

  function confirmDelete() {
    if (!deleteConfirm) return
    deleteMutation.mutate(deleteConfirm.id)
    setDeleteConfirm(null)
  }

  const canCreate = !!fromTag && !!toTag && fromTag !== toTag

  useModalHotkeys(() => setDeleteConfirm(null), confirmDelete, !deleteConfirm)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">{t('sidebar.version.deleteAnalysisTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">
              {t('sidebar.version.deleteAnalysisBody', { label: deleteConfirm.label })}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={confirmDelete} autoFocus
                className="btn-danger">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="px-3 py-2 border-b border-edge-subtle shrink-0 flex flex-col gap-2">
          <div>
            <p className="text-xs text-ink-3 mb-1">{t('sidebar.version.oldestBaseline')}</p>
            <BaselineCombobox baselines={baselines} value={fromTag} placeholder={t('sidebar.version.select')} onChange={(v) => setOrderedTags(v, toTag)} onCreateNew={goToCreateBaseline} />
          </div>
          <div>
            <p className="text-xs text-ink-3 mb-1">{t('sidebar.version.newestBaseline')}</p>
            <BaselineCombobox baselines={baselines} value={toTag} placeholder={t('sidebar.version.select')} onChange={(v) => setOrderedTags(fromTag, v)} onCreateNew={goToCreateBaseline} />
          </div>
          <p className="text-[11px] text-ink-3 italic">{t('sidebar.version.baselinesOrderHint')}</p>
          {fromTag && toTag && fromTag === toTag && (
            <p className="text-xs text-status-danger">{t('sidebar.version.baselinesMustDiffer')}</p>
          )}
          {createMutation.isError && (
            <p className="text-xs text-status-danger">
              {createMutation.error instanceof Error ? createMutation.error.message : t('sidebar.version.createAnalysisError')}
            </p>
          )}
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || createMutation.isPending}
            className="btn-primary flex items-center justify-center gap-1.5"
          >
            <Plus size={13} />
            {createMutation.isPending ? t('sidebar.version.analyzing') : t('sidebar.version.analyzeImpact')}
          </button>
        </div>

        <div className="px-3 py-2">
          <p className="text-xs text-ink-3 font-medium uppercase tracking-wide mb-1.5">{t('sidebar.version.existingAnalyses')}</p>
          {localCount > 0 && (
            <div className={`mb-0.5 rounded ${isLocalActive ? 'bg-hover ring-1 ring-prim' : ''}`}>
              <button
                type="button"
                onClick={() => setActiveAnalysisId(isLocalActive ? null : LOCAL_IMPACT_ANALYSIS_ID)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-hover transition-colors flex items-center gap-1.5 ${isLocalActive ? 'text-prim' : 'text-ink'}`}
              >
                <FilePen size={13} className="shrink-0" />
                <span className="italic truncate flex-1">{t('sidebar.version.localChanges')}</span>
                <span className="text-ink-3 shrink-0">{t('sidebar.version.localChangesCount', { count: localCount })}</span>
              </button>
            </div>
          )}
          {analyses.length === 0 ? (
            localCount === 0 && <p className="text-xs text-ink-3 italic">{t('sidebar.version.noAnalysis')}</p>
          ) : (
            <ul className="space-y-0.5">
              {analyses.map((a) => {
                const isActive = a.id === activeAnalysisId
                return (
                  <li key={a.id} className={`group flex items-center gap-1 rounded ${isActive ? 'bg-hover ring-1 ring-prim' : ''}`}>
                    <button
                      type="button"
                      onClick={() => openAnalysis(a)}
                      className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded text-xs hover:bg-hover transition-colors flex items-center justify-between gap-2 ${isActive ? 'text-prim' : 'text-ink'}`}
                    >
                      <span className="font-mono truncate">{a.label}</span>
                      <span className="text-ink-3 shrink-0">{new Date(a.createdAt).toLocaleDateString('fr-FR')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAnalysis(a.id, a.label)}
                      disabled={deleteMutation.isPending}
                      title={t('sidebar.version.deleteAnalysis')}
                      className={`shrink-0 p-1 rounded text-ink-3 hover:text-status-danger hover:bg-hover transition-colors disabled:opacity-50 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
