import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClearRevalidationResult } from '@polenta/types'
import { useFlaggedElements } from '../../hooks/useFlaggedElements'
import { useClearRevalidation } from '../../hooks/useClearRevalidation'
import type { RevalidationTreeState } from './ImpactTrees'

// Levée du flag needsRevalidation (SPEC-TRACEABILITY §4.8) : état live des éléments marqués,
// sélection multiple, levée et échecs — partagé par l'analyse d'un change, l'analyse locale et la
// liste « Impact à vérifier » (GH199, ex-page /impact-analysis).

export function useRevalidationTree(projectId: string, resetKey?: string) {
  const flaggedQuery = useFlaggedElements(projectId)
  const { flaggedIds } = flaggedQuery
  const clearMutation = useClearRevalidation(projectId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [failures, setFailures] = useState<ClearRevalidationResult['failed']>([])

  useEffect(() => { setSelected(new Set()); setFailures([]) }, [resetKey])
  // Un élément qui n'est plus marqué (levé ici ou ailleurs) sort de la sélection.
  useEffect(() => {
    setSelected(prev => {
      const next = new Set([...prev].filter(id => flaggedIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [flaggedIds])

  function clear(ids: string[]) {
    if (ids.length === 0) return
    clearMutation.mutate(ids, {
      onSuccess: result => {
        setFailures(result.failed)
        setSelected(prev => {
          const next = new Set(prev)
          for (const id of [...result.cleared, ...result.unchanged]) next.delete(id)
          return next
        })
      },
      onError: err => {
        const message = err instanceof Error ? err.message : String(err)
        setFailures(ids.map(id => ({ id, reason: 'error' as const, message })))
      },
    })
  }

  const tree: RevalidationTreeState = {
    flaggedIds,
    selected,
    toggle: id => setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    }),
    clear,
    pending: clearMutation.isPending,
  }
  return { flaggedQuery, tree, selected, setSelected, failures, setFailures, clear, pending: clearMutation.isPending }
}

export type RevalidationTree = ReturnType<typeof useRevalidationTree>

/** Bouton « Lever le flag de la sélection (N) », avec confirmation. */
export function ClearSelectionButton({ state }: { state: RevalidationTree }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  if (state.selected.size === 0) return null
  return (
    <>
      <button type="button" onClick={() => setConfirm(true)} disabled={state.pending} className="btn-secondary-sm shrink-0">
        {t('impactAnalysisPage.revalidation.clearSelection', { count: state.selected.size })}
      </button>
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={() => setConfirm(false)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">{t('impactAnalysisPage.revalidation.confirmTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">{t('impactAnalysisPage.revalidation.confirmBody', { count: state.selected.size })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="button" autoFocus className="btn-primary" onClick={() => { setConfirm(false); state.clear([...state.selected]) }}>
                {t('impactAnalysisPage.revalidation.clear')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Bandeau des échecs de levée, fermable. */
export function ClearFailuresBanner({ state }: { state: RevalidationTree }) {
  const { t } = useTranslation()
  if (state.failures.length === 0) return null
  return (
    <div className="px-4 py-2 border-b border-edge-subtle shrink-0 flex items-center gap-3 bg-hover">
      <p className="text-xs text-status-danger flex-1">
        {t('impactAnalysisPage.revalidation.failed', {
          items: state.failures.map(f => `${f.id} (${t(`impactAnalysisPage.revalidation.reason.${f.reason}`)})`).join(', '),
        })}
      </p>
      <button type="button" onClick={() => state.setFailures([])} className="btn-secondary-sm shrink-0">{t('common.close')}</button>
    </div>
  )
}
