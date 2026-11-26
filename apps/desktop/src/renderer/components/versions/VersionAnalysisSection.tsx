import { useMemo, useState } from 'react'
import { useSelectedRepo } from '../../contexts/SelectedRepoContext'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import type { ImpactAnalysisStatus, ImpactNode, VersionAnalysis, VersionImpactRoot, VersionImpactRow } from '@polenta/types'
import { CLOSED_STATUSES, ImpactTreeView } from '../impact/ImpactTrees'
import { RequirementEditModal } from '../impact/RequirementEditModal'
import { TestCaseEditModal } from '../impact/TestCaseEditModal'
import { DataGrid } from '../grid/DataGrid'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { useSectionOpen } from './useVersions'
import { VERSION_ANALYSIS_DEFAULTS, buildVersionAnalysisColumns, versionImpactRowClass, versionImpactRowId } from './versionAnalysisColumns'

/** Au-delà, les racines sont repliées à l'ouverture. */
const EXPANDED_ROOTS_MAX = 5

/**
 * GH245 §1 — analyse d'impact d'une version : racines et leurs arbres (statut éditable sur les nœuds),
 * puis les statuts saisis sur des éléments qui ne sont plus atteints. Une analyse figée (version
 * released) n'a plus d'arbres : ses lignes s'affichent en tableau (GH389 §4 : `DataGrid`), en lecture
 * seule ; les statuts hors arbres d'une analyse en cours, dans le même tableau, restent modifiables.
 */
export function VersionAnalysisSection({ analysis, isFetching, onRefresh, onSetImpact, repoPath, repoOfComponent, editable }: {
  analysis: VersionAnalysis | undefined
  isFetching: boolean
  onRefresh: () => void
  /** Écriture d'un statut d'impact ; attendue avant la suivante (même fichier de version). */
  onSetImpact: (id: string, status: ImpactAnalysisStatus, comment: string | null) => Promise<unknown>
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
  // Mémoïsés : colonnes et lignes stables pour la grille (cellules mémoïsées).
  const titleOf = useMemo(() => new Map<string, string>([
    ...(analysis?.roots ?? []).map(r => [r.elementId, r.title] as [string, string]),
    ...(analysis?.rows ?? []).map(r => [r.id, r.title ?? ''] as [string, string]),
  ]), [analysis])
  const readOnly = !editable || !!analysis?.frozen
  // Statut saisi sur un élément que les arbres n'atteignent plus : seule trace hors arbres.
  const unreached = useMemo(() => (analysis?.rows ?? []).filter(r => !r.reached), [analysis])

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
                {analysis.frozen && (rows.length === 0
                  ? <p className="text-xs text-ink-3 italic">{t('versions.analysis.noImpact')}</p>
                  : <ImpactRowsGrid rows={rows} readOnly={readOnly} titleOf={titleOf} repoPath={repoPath} title={t('versions.analysis.title')} onSetImpact={onSetImpact} />)}
                {!analysis.frozen && (
                  <div className="border border-edge-subtle rounded py-0.5" data-testid="version-impact-roots">
                    {analysis.roots.map(root => (
                      <RootRow
                        key={root.elementId}
                        root={root}
                        repoPath={rootRepoPath || repoPath}
                        rootRepo={repoOfComponent.get(root.component) ?? repoPath}
                        defaultExpanded={analysis.roots.length <= EXPANDED_ROOTS_MAX}
                        readOnly={readOnly}
                        onOpen={openElement}
                        onUpdateStatus={(node, status, comment) => void onSetImpact(node.elementId, status, comment)}
                      />
                    ))}
                  </div>
                )}
                {!analysis.frozen && unreached.length > 0 && (
                  <ImpactRowsGrid rows={unreached} readOnly={readOnly} titleOf={titleOf} repoPath={repoPath} title={t('versions.analysis.title')} onSetImpact={onSetImpact} />
                )}
              </>
            )
      )}

      {quickEdit?.type === 'requirement' && <RequirementEditModal repoPath={quickEdit.repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
      {quickEdit?.type === 'test_case' && <TestCaseEditModal repoPath={quickEdit.repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />}
    </section>
  )
}


/**
 * Lignes de l'analyse en tableau (GH389 §4) : ID en lien d'élément, statut (liste) et commentaire
 * éditables dans la cellule quand l'analyse l'est — en lot sur la sélection, comme la Vue Excel.
 */
function ImpactRowsGrid({ rows, readOnly, titleOf, repoPath, title, onSetImpact }: {
  rows: VersionImpactRow[]
  readOnly: boolean
  titleOf: Map<string, string>
  repoPath: string
  title: string
  onSetImpact: (id: string, status: ImpactAnalysisStatus, comment: string | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const scrollKey = useGridScrollKey('version-analysis')
  const columns = useMemo(() => buildVersionAnalysisColumns({ t, titleOf }), [t, titleOf])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::version-analysis', view: 'columns', defaults: VERSION_ANALYSIS_DEFAULTS }), [repoPath])
  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  // Une ligne après l'autre : chaque écriture relit et réécrit le même fichier de version. Un échec
  // est affiché par la page (message d'erreur de la version).
  const onCellEdit = async (ids: string[], key: string, value: string) => {
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue
      if (key === 'status') await onSetImpact(id, value as ImpactAnalysisStatus, row.comment?.trim() || null)
      else await onSetImpact(id, row.status, value.trim() || null)
    }
    return { failed: [] }
  }
  return (
    <div className="flex flex-col max-h-[60vh] min-h-0" data-testid="version-impact-rows">
      <DataGrid
        gridId="version-analysis"
        title={title}
        rows={rows}
        getRowId={versionImpactRowId}
        columns={columns}
        prefs={prefs}
        onCellEdit={readOnly ? undefined : onCellEdit}
        rowClassName={versionImpactRowClass}
        scrollMemoryKey={scrollKey}
        noExport
      />
    </div>
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
      <div className="flex items-center gap-1.5 py-0.5 text-sm">
        {hasTrees ? (
          <button type="button" onClick={() => setExpanded(e => !e)} className="text-ink-3 shrink-0" aria-label={expanded ? t('versions.collapse') : t('versions.expand')}>
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : <span className="w-[10px] shrink-0" />}
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{root.elementType === 'requirement' ? 'EX' : 'TC'}</span>
        <button type="button" onClick={() => onOpen(root.elementType, root.elementId, rootRepo)} className="font-mono text-ink font-medium hover:underline">{root.elementId}</button>
        <span className="text-ink-2 truncate flex-1">{root.title}</span>
        {root.viaIssues && <span className="text-xs text-ink-3 shrink-0" data-testid={`version-impact-via-${root.elementId}`}>{t('versions.analysis.viaIssues', { ids: root.viaIssues.join(', ') })}</span>}
        <span className="text-xs text-ink-3">{root.component}</span>
        {!hasTrees && <span className="text-xs text-ink-3">{t('versions.analysis.noImpact')}</span>}
      </div>
      {expanded && hasTrees && (
        <div>
          <ImpactTreeView nodes={root.descendantTree} repoPath={repoPath} onOpen={openNode} onUpdateStatus={onUpdateStatus} depth={1} readOnly={readOnly} dense />
          {root.ascendantTree.length > 0 && (
            <ImpactTreeView nodes={root.ascendantTree} repoPath={repoPath} onOpen={openNode} onUpdateStatus={onUpdateStatus} depth={1} readOnly={readOnly} dense />
          )}
        </div>
      )}
    </div>
  )
}
