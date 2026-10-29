import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ChangedRequirement, ImpactNode } from '@polenta/types'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ChangedRequirementRow, RevalidationTreeContext } from '../components/impact/ImpactTrees'
import { ClearFailuresBanner, ClearSelectionButton, useRevalidationTree } from '../components/impact/RevalidationControls'
import { RequirementEditModal } from '../components/impact/RequirementEditModal'
import { TestCaseEditModal } from '../components/impact/TestCaseEditModal'
import { useLocalImpactAnalysis } from '../hooks/useLocalImpactAnalysis'
import { useSetTabTitle } from '../contexts/TabsContext'

/** GH199 — analyse des modifications locales vs HEAD (SPEC-TRACEABILITY §4.7), dans la vue
 *  Changements (ex-entrée de la vue Analyse d'impact). URL : /changes/local?projectId=… */
export const Route = createFileRoute('/changes_/local')({
  component: LocalImpactPage,
  validateSearch: (s: Record<string, unknown>) => ({ projectId: (s['projectId'] as string) ?? '' }),
})

function LocalImpactPage() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  useSetTabTitle(t('impactAnalysisPage.localTitle'))
  const localQuery = useLocalImpactAnalysis(projectId)
  const analysis = localQuery.data
  const revalidation = useRevalidationTree(projectId)
  const rootRepoPath = analysis?.rootRepoPath ?? ''
  const [quickEdit, setQuickEdit] = useState<{ type: 'requirement' | 'test_case'; id: string; repoPath: string } | null>(null)

  const openChanged = (c: ChangedRequirement) => setQuickEdit({ type: c.elementType ?? 'requirement', id: c.reqId, repoPath: c.repo?.path ?? rootRepoPath })
  const openElement = (n: ImpactNode) => setQuickEdit({ type: n.elementType, id: n.elementId, repoPath: n.repo?.path ?? rootRepoPath })

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="local-impact-page">
      <ViewHeader
        currentProjectId={projectId}
        title={t('impactAnalysisPage.localTitle')}
        subtitle={analysis ? t('impactAnalysisPage.localComputedAt', { time: new Date(analysis.computedAt).toLocaleTimeString() }) : undefined}
        actions={
          <>
            <ClearSelectionButton state={revalidation} />
            <button type="button" onClick={() => localQuery.refetch()} disabled={localQuery.isFetching} className="btn-secondary-sm shrink-0 flex items-center gap-1.5">
              <RefreshCw size={12} className={localQuery.isFetching ? 'animate-spin' : ''} />
              {t('impactAnalysisPage.refresh')}
            </button>
          </>
        }
      />
      <ClearFailuresBanner state={revalidation} />
      <div className="flex-1 overflow-y-auto">
        {localQuery.isLoading ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('common.loading')}</p>
        ) : !analysis || analysis.changedRequirements.length === 0 ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('impactAnalysisPage.noChangedRequirement')}</p>
        ) : (
          <RevalidationTreeContext.Provider value={revalidation.tree}>
            {analysis.changedRequirements.map(cr => (
              <ChangedRequirementRow
                key={`${cr.elementType ?? 'requirement'}-${cr.reqId}`}
                changed={cr}
                repoPath={rootRepoPath}
                onOpenChanged={openChanged}
                onOpenElement={openElement}
                onUpdateItemStatus={() => {}}
                readOnly
              />
            ))}
          </RevalidationTreeContext.Provider>
        )}
      </div>
      {quickEdit?.type === 'requirement' && <RequirementEditModal repoPath={quickEdit.repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
      {quickEdit?.type === 'test_case' && <TestCaseEditModal repoPath={quickEdit.repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
    </div>
  )
}
