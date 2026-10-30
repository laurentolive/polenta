import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ViewHeader } from '../components/layout/ViewHeader'
import { RevalidationList } from '../components/impact/RevalidationList'
import { ClearFailuresBanner, ClearSelectionButton, useRevalidationTree } from '../components/impact/RevalidationControls'
import { RequirementEditModal } from '../components/impact/RequirementEditModal'
import { TestCaseEditModal } from '../components/impact/TestCaseEditModal'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { useSetTabTitle } from '../contexts/TabsContext'

/** GH199 — liste « Impact à vérifier » (éléments marqués needsRevalidation, SPEC-TRACEABILITY §4.8),
 *  dans la vue Changements (ex-entrée de la vue Analyse d'impact). URL : /changes/revalidation?projectId=… */
export const Route = createFileRoute('/changesets_/revalidation')({
  component: RevalidationPage,
  validateSearch: (s: Record<string, unknown>) => ({ projectId: (s['projectId'] as string) ?? '' }),
})

function RevalidationPage() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  useSetTabTitle(t('impactAnalysisPage.revalidation.listTitle'))
  const { rootRepoPath } = useSelectedRepo()
  const revalidation = useRevalidationTree(projectId)
  const { flaggedQuery } = revalidation
  const flagged = flaggedQuery.data
  const [quickEdit, setQuickEdit] = useState<{ type: 'requirement' | 'test_case'; id: string; repoPath: string } | null>(null)

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="revalidation-page">
      <ViewHeader
        currentProjectId={projectId}
        title={t('impactAnalysisPage.revalidation.listTitle')}
        subtitle={flagged ? t('impactAnalysisPage.revalidation.listSubtitle', { count: flagged.length }) : undefined}
        actions={
          <>
            <ClearSelectionButton state={revalidation} />
            <button type="button" onClick={() => flaggedQuery.refetch()} disabled={flaggedQuery.isFetching} className="btn-secondary-sm shrink-0 flex items-center gap-1.5">
              <RefreshCw size={12} className={flaggedQuery.isFetching ? 'animate-spin' : ''} />
              {t('impactAnalysisPage.refresh')}
            </button>
          </>
        }
      />
      <ClearFailuresBanner state={revalidation} />
      <div className="flex-1 overflow-y-auto">
        {flaggedQuery.isError ? (
          <p className="text-sm text-status-danger px-4 py-3">
            {t('impactAnalysisPage.revalidation.loadError', { message: flaggedQuery.error instanceof Error ? flaggedQuery.error.message : String(flaggedQuery.error) })}
          </p>
        ) : !flagged ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('common.loading')}</p>
        ) : flagged.length === 0 ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('changes.noFlagged')}</p>
        ) : (
          <RevalidationList
            elements={flagged}
            rootRepoPath={rootRepoPath}
            selected={revalidation.selected}
            toggle={revalidation.tree.toggle}
            setSelected={revalidation.setSelected}
            clear={revalidation.clear}
            pending={revalidation.pending}
            onOpen={(type, id, elementRepoPath) => setQuickEdit({ type, id, repoPath: elementRepoPath })}
          />
        )}
      </div>
      {quickEdit?.type === 'requirement' && <RequirementEditModal repoPath={quickEdit.repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
      {quickEdit?.type === 'test_case' && <TestCaseEditModal repoPath={quickEdit.repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
    </div>
  )
}
