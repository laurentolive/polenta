import { useEffect, useState } from 'react'
import { useSelectedRepo } from '../../contexts/SelectedRepoContext'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import type { ImpactAnalysisStatus, ImpactNode, VersionAnalysis, VersionImpactRoot, VersionImpactRow } from '@polenta/types'
import { IMPACT_ANALYSIS_STATUSES } from '@polenta/types'
import { STATUS_LABEL_KEY } from '../../lib/impactStatus'
import { CLOSED_STATUSES, ImpactTreeView } from '../impact/ImpactTrees'
import { RequirementEditModal } from '../impact/RequirementEditModal'
import { TestCaseEditModal } from '../impact/TestCaseEditModal'
import { useSectionOpen } from './useVersions'

/** Au-delà, les racines sont repliées à l'ouverture. */
const EXPANDED_ROOTS_MAX = 5

/**
 * GH245 §1 — analyse d'impact d'une version : lignes (éléments impactés du composant, statut,
 * commentaire, source), puis les racines et leurs arbres (statut éditable sur les nœuds). Figée et en
 * lecture seule pour une version released.
 */
export function VersionAnalysisSection({ analysis, isFetching, onRefresh, onSetImpact, repoPath, repoOfComponent, editable }: {
  analysis: VersionAnalysis | undefined
  isFetching: boolean
  onRefresh: () => void
  onSetImpact: (id: string, status: ImpactAnalysisStatus, comment: string | null) => void
  repoPath: string
  /** Repo de chaque composant (nom de montage) : une racine peut appartenir à un composant. */
  repoOfComponent: Map<string, string>
  editable: boolean
}) {
  const { t, i18n } = useTranslation()
  // Les nœuds des arbres sans `repo` sont dans le repo racine du workspace (snapshot de l'analyse).
  const { rootRepoPath } = useSelectedRepo()
  const [open, setOpen] = useSectionOpen('analysis')
  const [quickEdit, setQuickEdit] = useState<{ type: 'requirement' | 'test_case'; id: string; repoPath: string } | null>(null)
  const openElement = (type: 'requirement' | 'test_case', id: string, rp?: string) => setQuickEdit({ type, id, repoPath: rp ?? repoPath })
  const rows = analysis?.rows ?? []
  const openCount = rows.filter(r => !CLOSED_STATUSES.has(r.status)).length
  const when = analysis?.computedAt ? new Date(analysis.computedAt).toLocaleString(i18n.language) : ''
  const titleOf = new Map<string, string>([
    ...(analysis?.roots ?? []).map(r => [r.elementId, r.title] as [string, string]),
    ...rows.map(r => [r.id, r.title ?? ''] as [string, string]),
  ])
  const readOnly = !editable || !!analysis?.frozen

  return (
    <section className="flex flex-col gap-2" data-testid="version-analysis">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-1 section-label hover:text-ink">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {t('versions.analysis.title')}
          {analysis && <span className="font-normal text-ink-3 normal-case">({rows.length})</span>}
        </button>
        {analysis && (
          <span className="text-xs text-ink-3">{analysis.frozen ? t('versions.analysis.frozen', { when }) : t('versions.analysis.computed', { when })}</span>
        )}
        {rows.length > 0 && (
          openCount === 0
            ? <span className="text-xs text-status-success font-medium">{t('impactAnalysisPage.allImpactsHandled')}</span>
            : <span className="text-xs text-ink-3">{t('impactAnalysisPage.openCount', { count: openCount, total: rows.length })}</span>
        )}
        <div className="flex-1" />
        {!analysis?.frozen && (
          <button type="button" onClick={onRefresh} disabled={isFetching} className="btn-secondary-sm flex items-center gap-1.5">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            {t('impactAnalysisPage.refresh')}
          </button>
        )}
      </div>

      {open && (
        !analysis ? <p className="text-xs text-ink-3 italic">{t('common.loading')}</p>
          : analysis.roots.length === 0 ? <p className="text-xs text-ink-3 italic">{t('versions.analysis.noRoot')}</p>
            : (
              <>
                {rows.length === 0
                  ? <p className="text-xs text-ink-3 italic">{t('versions.analysis.noImpact')}</p>
                  : (
                    <table className="w-full text-xs border-collapse" data-testid="version-impact-rows">
                      <thead>
                        <tr className="text-left text-ink-3 border-b border-edge">
                          <th className="py-1 pr-3 font-medium">{t('versions.columns.id')}</th>
                          <th className="py-1 pr-3 font-medium">{t('versions.columns.label')}</th>
                          <th className="py-1 pr-3 font-medium">{t('versions.analysis.status')}</th>
                          <th className="py-1 pr-3 font-medium">{t('versions.analysis.comment')}</th>
                          <th className="py-1 font-medium">{t('versions.analysis.source')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <ImpactRow key={r.id} row={r} readOnly={readOnly} titleOf={titleOf} onOpen={openElement} onSetImpact={onSetImpact} />
                        ))}
                      </tbody>
                    </table>
                  )}
                {!analysis.frozen && (
                  <div className="border border-edge-subtle rounded" data-testid="version-impact-roots">
                    {analysis.roots.map(root => (
                      <RootRow
                        key={root.elementId}
                        root={root}
                        repoPath={rootRepoPath || repoPath}
                        rootRepo={repoOfComponent.get(root.component) ?? repoPath}
                        defaultExpanded={analysis.roots.length <= EXPANDED_ROOTS_MAX}
                        readOnly={readOnly}
                        onOpen={openElement}
                        onUpdateStatus={(node, status, comment) => onSetImpact(node.elementId, status, comment)}
                      />
                    ))}
                  </div>
                )}
              </>
            )
      )}

      {quickEdit?.type === 'requirement' && <RequirementEditModal repoPath={quickEdit.repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
      {quickEdit?.type === 'test_case' && <TestCaseEditModal repoPath={quickEdit.repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
    </section>
  )
}

function ImpactRow({ row, readOnly, titleOf, onOpen, onSetImpact }: {
  row: VersionImpactRow
  readOnly: boolean
  titleOf: Map<string, string>
  onOpen: (type: 'requirement' | 'test_case', id: string) => void
  onSetImpact: (id: string, status: ImpactAnalysisStatus, comment: string | null) => void
}) {
  const { t } = useTranslation()
  const [comment, setComment] = useState(row.comment ?? '')
  useEffect(() => { setComment(row.comment ?? '') }, [row.comment])
  const [first, ...others] = row.sources
  const pathText = (s: typeof first) => [s.rootId, ...s.path.map(p => p.id)].join(' → ')
  return (
    <tr className={`border-b border-edge-subtle ${row.reached ? '' : 'opacity-60'}`} data-testid={`version-impact-${row.id}`}>
      <td className="py-1 pr-3">
        {row.elementType
          ? <button type="button" onClick={() => onOpen(row.elementType!, row.id)} className="font-mono text-prim hover:underline">{row.id}</button>
          : <span className="font-mono text-ink-3">{row.id}</span>}
      </td>
      <td className="py-1 pr-3 text-ink">
        {row.title}
        {!row.reached && <span className="ml-2 text-[10px] text-ink-3 italic">{t('versions.analysis.notReached')}</span>}
      </td>
      <td className="py-1 pr-3">
        {readOnly ? <span className={CLOSED_STATUSES.has(row.status) ? 'text-status-success' : 'text-ink-2'}>{t(STATUS_LABEL_KEY[row.status])}</span> : (
          <select value={row.status} onChange={e => onSetImpact(row.id, e.target.value as ImpactAnalysisStatus, comment.trim() || null)} className="input-field text-xs py-0.5" data-testid={`version-impact-status-${row.id}`}>
            {IMPACT_ANALYSIS_STATUSES.map(s => <option key={s} value={s}>{t(STATUS_LABEL_KEY[s])}</option>)}
          </select>
        )}
      </td>
      <td className="py-1 pr-3">
        {readOnly ? <span className="text-ink-2">{row.comment}</span> : (
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            onBlur={() => { if ((row.comment ?? '') !== comment.trim()) onSetImpact(row.id, row.status, comment.trim() || null) }}
            placeholder={t('impactAnalysisPage.commentPlaceholder')}
            className="input-field text-xs py-0.5 w-full"
          />
        )}
      </td>
      <td className="py-1 text-ink-3 font-mono text-[11px]">
        {first && (
          <span title={row.sources.map(s => [s.rootId, ...s.path.map(p => p.id)].map(id => `${id} ${titleOf.get(id) ?? ''}`.trim()).join(' → ')).join('\n')}>
            {pathText(first)}{others.length > 0 && <span className="ml-1 text-ink-2">+{others.length}</span>}
          </span>
        )}
      </td>
    </tr>
  )
}

function RootRow({ root, repoPath, rootRepo, defaultExpanded, readOnly, onOpen, onUpdateStatus }: {
  root: VersionImpactRoot
  /** Repo racine du workspace (nœuds sans `repo`). */
  repoPath: string
  /** Repo du composant qui porte la racine. */
  rootRepo: string
  defaultExpanded: boolean
  readOnly: boolean
  onOpen: (type: 'requirement' | 'test_case', id: string, repoPath?: string) => void
  onUpdateStatus: (node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasTrees = root.descendantTree.length > 0 || root.ascendantTree.length > 0
  const openNode = (n: ImpactNode) => onOpen(n.elementType, n.elementId, n.repo?.path ?? repoPath)
  return (
    <div className="border-b border-edge-subtle last:border-b-0" data-testid={`version-impact-root-${root.elementId}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        {hasTrees ? (
          <button type="button" onClick={() => setExpanded(e => !e)} className="text-ink-3 shrink-0" aria-label={expanded ? t('versions.collapse') : t('versions.expand')}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : <span className="w-[13px] shrink-0" />}
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{root.elementType === 'requirement' ? 'EX' : 'TC'}</span>
        <button type="button" onClick={() => onOpen(root.elementType, root.elementId, rootRepo)} className="font-mono text-ink font-medium hover:underline">{root.elementId}</button>
        <span className="text-ink-2 truncate flex-1">{root.title}</span>
        <span className="text-xs text-ink-3">{root.component}</span>
        {!hasTrees && <span className="text-xs text-ink-3">{t('versions.analysis.noImpact')}</span>}
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
