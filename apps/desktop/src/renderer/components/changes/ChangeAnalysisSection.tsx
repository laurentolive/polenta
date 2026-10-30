import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { CLOSED_IMPACT_STATUSES, type Change, type ChangeAnalysis, type ChangeAnalysisRoot, type ChangeImpactStatus, type ImpactNode } from '@polenta/types'
import { ImpactTreeView, RevalidationTreeContext, useRequirementStatementTooltip } from '../impact/ImpactTrees'
import { ClearFailuresBanner, ClearSelectionButton, useRevalidationTree } from '../impact/RevalidationControls'
import { RequirementEditModal } from '../impact/RequirementEditModal'
import { TestCaseEditModal } from '../impact/TestCaseEditModal'
import { ExportButton } from '../export/ExportButton'
import { impactAnalysisExportBaseName } from '../export/exportFilenames'

/** Au-delà, les racines sont repliées à l'ouverture. */
const EXPANDED_ROOTS_MAX = 5

/**
 * GH199 — section « Analyse d'impact » de la page d'un change (specs/GH199.md §6) : mode et bornes,
 * calculée / figée, complétude, racines et leurs arbres (statut d'impact par élément), campagnes en
 * cours concernées, export, levée du flag needsRevalidation.
 */
export function ChangeAnalysisSection({ change, analysis, isFetching, onRefresh, onSetImpact, repoPath, projectId, disabled }: {
  change: Change
  analysis: ChangeAnalysis | undefined
  isFetching: boolean
  onRefresh: () => void
  onSetImpact: (id: string, status: ChangeImpactStatus, comment: string | undefined) => void
  repoPath: string
  projectId: string
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const revalidation = useRevalidationTree(projectId, change.id)
  const [quickEdit, setQuickEdit] = useState<{ type: 'requirement' | 'test_case'; id: string; repoPath: string } | null>(null)
  const [sectionOpen, setSectionOpen] = useState(true)
  const readOnly = disabled || !!analysis?.frozen
  const open = (type: 'requirement' | 'test_case', id: string, rp?: string) => setQuickEdit({ type, id, repoPath: rp ?? repoPath })
  const onUpdateStatus = (node: ImpactNode, status: ChangeImpactStatus, comment: string | null) => onSetImpact(node.elementId, status, comment ?? undefined)

  const rows = analysis?.rows ?? []
  const openCount = rows.filter(r => !CLOSED_IMPACT_STATUSES.includes(r.status)).length
  const when = analysis ? new Date(analysis.computedAt).toLocaleString(i18n.language) : ''

  return (
    <section className="border rounded mb-4" data-testid="change-analysis">
      <div className={`flex flex-wrap items-center gap-3 px-3 py-2 ${sectionOpen ? 'border-b border-edge-subtle' : ''}`}>
        {/* Repliable comme les listes du change (GH199) ; le nombre de racines reste visible. */}
        <button type="button" onClick={() => setSectionOpen(o => !o)} aria-expanded={sectionOpen} data-testid="change-analysis-toggle"
          className="flex items-center gap-1 text-xs font-semibold text-ink-2 uppercase tracking-wide hover:text-ink">
          {sectionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {t('changes.analysis.title')}
          {analysis && <span className="font-normal text-ink-3 normal-case">({analysis.roots.length})</span>}
        </button>
        <span className="text-xs text-ink-3">
          {change.mode === 'range' && change.range
            ? t('changes.analysis.range', { from: change.range.from.ref, to: change.range.to.ref })
            : t('changes.analysis.request')}
        </span>
        {analysis && (
          <span className="text-xs text-ink-3" data-testid="change-analysis-state">
            {analysis.frozen ? t('changes.analysis.frozen', { when }) : t('changes.analysis.computed', { when })}
          </span>
        )}
        <div className="flex-1" />
        {rows.length > 0 && (
          openCount === 0
            ? <span className="text-xs text-status-success font-medium" data-testid="change-analysis-complete">{t('impactAnalysisPage.allImpactsHandled')}</span>
            : <span className="text-xs text-ink-3" data-testid="change-analysis-open">{t('impactAnalysisPage.openCount', { count: openCount, total: rows.length })}</span>
        )}
        <ClearSelectionButton state={revalidation} />
        {analysis && (
          <ExportButton
            kind="impact-analysis"
            formats={['xlsx', 'pdf']}
            repoPath={repoPath}
            getSuggestedBaseName={() => impactAnalysisExportBaseName(change.id)}
            getPayload={() => ({ change: { id: change.id, title: change.title, mode: change.mode, ...(change.range && { range: change.range }) }, analysis })}
            getPrintParams={() => ({ repoPath, changeId: change.id })}
          />
        )}
        {!analysis?.frozen && (
          <button type="button" onClick={onRefresh} disabled={isFetching} className="btn-secondary-sm flex items-center gap-1.5" data-testid="change-analysis-refresh">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            {t('impactAnalysisPage.refresh')}
          </button>
        )}
      </div>
      {sectionOpen && <>
      <ClearFailuresBanner state={revalidation} />

      {!analysis ? (
        <p className="text-xs text-ink-3 italic px-3 py-2">{t('common.loading')}</p>
      ) : analysis.roots.length === 0 ? (
        <p className="text-xs text-ink-3 italic px-3 py-2">{t('changes.analysis.noRoot')}</p>
      ) : (
        <RevalidationTreeContext.Provider value={revalidation.tree}>
          <div className="py-1">
            {analysis.roots.map(root => (
              <RootRow
                key={`${root.elementType}-${root.elementId}`}
                root={root}
                repoPath={repoPath}
                defaultExpanded={analysis.roots.length <= EXPANDED_ROOTS_MAX}
                onOpen={open}
                onUpdateStatus={onUpdateStatus}
                readOnly={readOnly}
              />
            ))}
          </div>
        </RevalidationTreeContext.Provider>
      )}

      {analysis && analysis.campaigns.length > 0 && (
        <div className="px-3 py-2 border-t border-edge-subtle" data-testid="change-analysis-campaigns">
          <p className="text-xs font-semibold text-ink-2 mb-1">{t('changes.analysis.campaigns')}</p>
          <ul className="space-y-0.5">
            {analysis.campaigns.map(c => (
              <li key={c.id} className="text-xs flex items-center gap-2">
                <Link to="/campaign/$campaignId" params={{ campaignId: c.id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline">{c.id}</Link>
                <span className="text-ink truncate">{c.title}</span>
                <span className="text-ink-3 truncate">{c.testIds.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      </>}

      {quickEdit?.type === 'requirement' && <RequirementEditModal repoPath={quickEdit.repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
      {quickEdit?.type === 'test_case' && <TestCaseEditModal repoPath={quickEdit.repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
    </section>
  )
}

function RootRow({ root, repoPath, defaultExpanded, onOpen, onUpdateStatus, readOnly }: {
  root: ChangeAnalysisRoot
  repoPath: string
  defaultExpanded: boolean
  onOpen: (type: 'requirement' | 'test_case', id: string, repoPath?: string) => void
  onUpdateStatus: (node: ImpactNode, status: ChangeImpactStatus, comment: string | null) => void
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isRequirement = root.elementType === 'requirement'
  const tooltip = useRequirementStatementTooltip(isRequirement ? repoPath : '', isRequirement ? root.elementId : '', root.title)
  const hasTrees = root.descendantTree.length > 0 || root.ascendantTree.length > 0
  const openNode = (n: ImpactNode) => onOpen(n.elementType, n.elementId, n.repo?.path)
  return (
    <div className="border-b border-edge-subtle last:border-b-0" data-testid={`change-analysis-root-${root.elementId}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        {hasTrees ? (
          <button type="button" onClick={() => setExpanded(e => !e)} className="text-ink-3 shrink-0">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : <span className="w-[13px] shrink-0" />}
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{isRequirement ? 'EX' : 'TC'}</span>
        <button type="button" onClick={() => onOpen(root.elementType, root.elementId)} className="font-mono text-ink font-medium hover:underline" title={tooltip}>
          {root.elementId}
        </button>
        <span className="text-ink-2 truncate flex-1" title={tooltip}>{root.title}</span>
        {!hasTrees && <span className="text-xs text-ink-3">{t('changes.analysis.noImpact')}</span>}
      </div>
      {expanded && hasTrees && (
        <div className="pb-1">
          <ImpactTreeView nodes={root.descendantTree} repoPath={repoPath} onOpen={openNode} onUpdateStatus={onUpdateStatus} depth={1} readOnly={readOnly} />
          {root.ascendantTree.length > 0 && (
            <ImpactTreeView nodes={root.ascendantTree} repoPath={repoPath} onOpen={openNode} onUpdateStatus={onUpdateStatus} depth={1} readOnly={readOnly} />
          )}
        </div>
      )}
    </div>
  )
}
