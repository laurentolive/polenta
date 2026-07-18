import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { useImpactAnalysis } from '../contexts/ImpactAnalysisContext'
import { RequirementEditModal } from '../components/impact/RequirementEditModal'
import { TestCaseEditModal } from '../components/impact/TestCaseEditModal'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ExportButton } from '../components/export/ExportButton'
import { impactAnalysisExportBaseName } from '../components/export/exportFilenames'
import type {
  ImpactAnalysis,
  ChangedRequirement,
  ImpactNode,
  Requirement,
  RequirementChangeType,
  ImpactAnalysisStatus,
} from '@polenta/types'

export const Route = createFileRoute('/impact-analysis')({
  component: ImpactAnalysisPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

// ── Libellés ─────────────────────────────────────────────────────────────────

const CHANGE_TYPE_LABEL: Record<RequirementChangeType, string> = {
  added: 'Ajoutée',
  removed: 'Supprimée',
  modified: 'Modifiée',
}

const CHANGE_TYPE_COLOR: Record<RequirementChangeType, string> = {
  added: 'text-green-600',
  removed: 'text-red-500',
  modified: 'text-amber-500',
}

const STATUS_LABEL: Record<ImpactAnalysisStatus, string> = {
  impact_non_verifie: 'Impact non vérifié',
  pas_d_impact_reel: "Pas d'impact réel",
  impact_a_tester: 'Impact à tester',
  impact_teste: 'Impact testé',
  modification_a_faire: 'Modification à faire',
  modification_faite: 'Modification faite',
  modification_a_tester: 'Modification à tester',
  modification_verifiee: 'Modification vérifiée',
}

const STATUS_ORDER: ImpactAnalysisStatus[] = [
  'impact_non_verifie',
  'pas_d_impact_reel',
  'impact_a_tester',
  'impact_teste',
  'modification_a_faire',
  'modification_faite',
  'modification_a_tester',
  'modification_verifiee',
]

// Statuts "clos" pour l'indicateur de complétude (point 6 de la spec) — ne contraint pas les
// transitions, sert uniquement à compter ouverts/clos.
const CLOSED_STATUSES = new Set<ImpactAnalysisStatus>(['pas_d_impact_reel', 'impact_teste', 'modification_verifiee'])
const TO_TEST_STATUSES = new Set<ImpactAnalysisStatus>(['impact_a_tester', 'modification_a_tester'])

// ── Parcours de l'arbre ──────────────────────────────────────────────────────

function flattenNodes(nodes: ImpactNode[]): ImpactNode[] {
  const result: ImpactNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...flattenNodes(node.children))
  }
  return result
}

function flattenAnalysis(analysis: ImpactAnalysis): ImpactNode[] {
  return analysis.changedRequirements.flatMap((cr) => [...flattenNodes(cr.descendantTree), ...flattenNodes(cr.ascendantTree)])
}

// ── ImpactTreeView (récursif) ────────────────────────────────────────────────

const COMMENT_MAX_LINES = 3

// Auto-grandit avec le contenu (1 ligne vide → 3 lignes max), puis scrollbar — pas de
// redimensionnement manuel, la hauteur suit uniquement ce qui est tapé.
function resizeCommentTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const style = window.getComputedStyle(el)
  const lineHeight = parseFloat(style.lineHeight) || 16
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  const maxHeight = lineHeight * COMMENT_MAX_LINES + paddingY + borderY
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  el.style.overflowY = el.scrollHeight > maxHeight + 0.5 ? 'auto' : 'hidden'
}

type UpdateNodeStatus = (node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) => void

interface ImpactTreeViewProps {
  nodes: ImpactNode[]
  repoPath: string
  onOpen: (node: ImpactNode) => void
  onUpdateStatus: UpdateNodeStatus
  depth?: number
}

// L'énoncé EARS courant d'une exigence n'est pas assez court pour tenir dans la liste — la
// ligne affiche le titre, l'énoncé complet reste consultable au survol (tooltip natif, id ou
// titre) et dans le popup en lecture seule (RequirementEditModal). Partage la clé de query avec
// ce popup pour profiter du cache déjà chaud si l'utilisateur l'a ouvert.
function useRequirementStatementTooltip(repoPath: string, reqId: string, fallback: string): string {
  const { data: req } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath && !!reqId,
  })
  const rawStatement = req?.fields ? (req.fields as Record<string, unknown>)['statement'] : undefined
  return (typeof rawStatement === 'string' && rawStatement.trim() ? rawStatement : fallback).replace(/\s+/g, ' ').trim()
}

function ImpactNodeStatusEditor({ node, onUpdateStatus }: { node: ImpactNode; onUpdateStatus: UpdateNodeStatus }) {
  // Brouillon combiné statut+commentaire, pas deux states indépendants — resynchronisé sur
  // `node` (la ligne peut être réutilisée par React sans remonter, ex. rouvrir une autre
  // analyse dont un nœud partage la même clé). Chaque validation envoie systématiquement les
  // deux champs ensemble : évite qu'un blur de commentaire renvoie un `node.status` obsolète
  // pendant qu'une mise à jour de statut est encore en vol (perte de mise à jour croisée).
  const [draft, setDraft] = useState({ status: node.status, comment: node.comment ?? '' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft({ status: node.status, comment: node.comment ?? '' })
  }, [node.status, node.comment])

  useEffect(() => {
    resizeCommentTextarea(textareaRef.current)
  }, [draft.comment])

  function commitStatus(status: ImpactAnalysisStatus) {
    setDraft((d) => ({ ...d, status }))
    onUpdateStatus(node, status, draft.comment.trim() || null)
  }

  function commitComment() {
    onUpdateStatus(node, draft.status, draft.comment.trim() || null)
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        value={draft.comment}
        onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
        onBlur={commitComment}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            commitComment()
            e.currentTarget.blur()
          }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="Commentaire…"
        rows={1}
        className="w-1/4 shrink-0 resize-none text-xs bg-surface border border-edge-subtle rounded px-1.5 py-1 text-ink leading-4"
      />
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          CLOSED_STATUSES.has(draft.status) ? 'bg-green-500' : 'bg-transparent'
        }`}
        title={CLOSED_STATUSES.has(draft.status) ? 'Risque levé' : undefined}
      />
      <select
        value={draft.status}
        onChange={(e) => commitStatus(e.target.value as ImpactAnalysisStatus)}
        className={`shrink-0 text-xs bg-surface border rounded px-1.5 py-1 text-ink max-w-[9rem] ${
          CLOSED_STATUSES.has(draft.status) ? 'border-green-400 dark:border-green-700' : 'border-edge-subtle'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
    </>
  )
}

function ImpactTreeNodeRow({ node, repoPath, onOpen, onUpdateStatus, depth }: { node: ImpactNode; repoPath: string; onOpen: (node: ImpactNode) => void; onUpdateStatus: UpdateNodeStatus; depth: number }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const badge = node.elementType === 'requirement' ? 'EX' : 'TC'
  const isRequirement = node.elementType === 'requirement'
  // Le hook est toujours appelé (règle des hooks) ; sa query interne reste désactivée pour un
  // test_case — le résultat retombe alors simplement sur `node.title`.
  const statementTooltip = useRequirementStatementTooltip(isRequirement ? repoPath : '', isRequirement ? node.elementId : '', node.title)
  const tooltip = isRequirement ? statementTooltip : node.title

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 text-sm hover:bg-hover rounded transition-colors group"
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        {hasChildren ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="text-ink-3 shrink-0">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{badge}</span>
        <button
          type="button"
          onClick={() => onOpen(node)}
          className="font-mono text-ink truncate hover:underline text-left"
          title={tooltip}
        >
          {node.elementId}
        </button>
        <span className="text-ink-2 truncate min-w-0 flex-1" title={tooltip}>
          {node.title}
        </span>
        <ImpactNodeStatusEditor node={node} onUpdateStatus={onUpdateStatus} />
      </div>
      {hasChildren && expanded && (
        <ImpactTreeView nodes={node.children} repoPath={repoPath} onOpen={onOpen} onUpdateStatus={onUpdateStatus} depth={depth + 1} />
      )}
    </div>
  )
}

function ImpactTreeView({ nodes, repoPath, onOpen, onUpdateStatus, depth = 0 }: ImpactTreeViewProps) {
  if (nodes.length === 0) return null
  return (
    <div>
      {nodes.map((node) => (
        <ImpactTreeNodeRow key={`${node.elementType}-${node.elementId}`} node={node} repoPath={repoPath} onOpen={onOpen} onUpdateStatus={onUpdateStatus} depth={depth} />
      ))}
    </div>
  )
}

// ── ChangedRequirementRow ────────────────────────────────────────────────────

function ChangedRequirementRow({
  changed,
  repoPath,
  onOpenRequirement,
  onOpenElement,
  onUpdateItemStatus,
}: {
  changed: ChangedRequirement
  repoPath: string
  onOpenRequirement: (reqId: string) => void
  onOpenElement: (node: ImpactNode) => void
  onUpdateItemStatus: (reqId: string, direction: 'descendant' | 'ascendant', node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasTrees = changed.descendantTree.length > 0 || changed.ascendantTree.length > 0
  const onUpdateDescendant: UpdateNodeStatus = (node, status, comment) => onUpdateItemStatus(changed.reqId, 'descendant', node, status, comment)
  const onUpdateAscendant: UpdateNodeStatus = (node, status, comment) => onUpdateItemStatus(changed.reqId, 'ascendant', node, status, comment)
  // Le diff brut du champ statement (EARS, potentiellement long/multi-lignes) est redondant avec
  // l'énoncé déjà consultable au survol du titre/id — retiré de la liste des champs changés.
  const changedFields = changed.changedFields.filter((f) => f.field !== 'fields.statement')
  const statementTooltip = useRequirementStatementTooltip(repoPath, changed.reqId, changed.title)

  return (
    <div className="border-b border-edge-subtle">
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-hover transition-colors">
        {hasTrees ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="text-ink-3 shrink-0">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onOpenRequirement(changed.reqId)}
          className="font-mono text-ink font-medium truncate hover:underline text-left"
          title={statementTooltip}
        >
          {changed.reqId}
        </button>
        <span className="text-ink-2 truncate flex-1" title={statementTooltip}>{changed.title}</span>
        <span className={`text-xs font-medium shrink-0 ${CHANGE_TYPE_COLOR[changed.changeType]}`}>
          {CHANGE_TYPE_LABEL[changed.changeType]}
        </span>
      </div>

      {changedFields.length > 0 && (
        <div className="px-10 pb-2 space-y-0.5">
          {changedFields.map((f) => (
            <div key={f.field} className="text-xs text-ink-3 font-mono truncate">
              <span className="text-ink-2">{f.field}</span> : {JSON.stringify(f.from)} → {JSON.stringify(f.to)}
            </div>
          ))}
        </div>
      )}

      {expanded && hasTrees && (
        <div className="pb-2">
          {changed.descendantTree.length > 0 && (
            <ImpactTreeView nodes={changed.descendantTree} repoPath={repoPath} onOpen={onOpenElement} onUpdateStatus={onUpdateDescendant} depth={1} />
          )}
          {changed.ascendantTree.length > 0 && (
            <>
              <p className="text-xs text-ink-3 uppercase tracking-wide px-2 pt-1" style={{ paddingLeft: '26px' }}>
                Arbre montant
              </p>
              <ImpactTreeView nodes={changed.ascendantTree} repoPath={repoPath} onOpen={onOpenElement} onUpdateStatus={onUpdateAscendant} depth={1} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── ImpactAnalysisPage ───────────────────────────────────────────────────────
// Le panneau latéral (sélection des baselines, création, liste des analyses) vit désormais
// dans le panel Version (VersionImpactSelector) — cette page n'affiche plus que le contenu
// principal : barre de titre avec la plage de baselines comparées, et la liste (en grand)
// des exigences impactées pour l'analyse active, lue depuis ImpactAnalysisContext.
function ImpactAnalysisPage() {
  const { projectId } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { selectedRepoPath } = useSelectedRepo()
  const { activeAnalysisId } = useImpactAnalysis()
  const repoPath = selectedRepoPath

  const { data: activeAnalysis, isLoading: isLoadingAnalysis } = useQuery<ImpactAnalysis>({
    queryKey: ['impact-analysis:get', repoPath, activeAnalysisId],
    queryFn: () => api.impactAnalysis.get(repoPath, activeAnalysisId!),
    enabled: !!repoPath && !!activeAnalysisId,
  })

  // `analysisId` voyage dans les variables de la mutation (pas dans une fermeture sur
  // `activeAnalysisId`) : react-query relie `onSuccess` aux options du dernier rendu, pas à
  // celles actives au moment de l'appel `.mutate()` — sans ça, changer d'analyse pendant
  // qu'une mise à jour de statut est en vol écrirait la réponse dans le mauvais cache.
  const updateStatusMutation = useMutation({
    mutationFn: (vars: { analysisId: string; reqId: string; direction: 'descendant' | 'ascendant'; elementId: string; status: ImpactAnalysisStatus; comment: string | null }) =>
      api.impactAnalysis.updateStatus(repoPath, vars.analysisId, vars),
    onSuccess: (updated, vars) => {
      qc.setQueryData(['impact-analysis:get', repoPath, vars.analysisId], updated)
    },
  })

  function updateItemStatus(reqId: string, direction: 'descendant' | 'ascendant', node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) {
    if (!activeAnalysisId) return
    updateStatusMutation.mutate({ analysisId: activeAnalysisId, reqId, direction, elementId: node.elementId, status, comment })
  }

  const allNodes = useMemo(() => (activeAnalysis ? flattenAnalysis(activeAnalysis) : []), [activeAnalysis])

  const [campaignDraft, setCampaignDraft] = useState<{ testCaseIds: string[]; uncoveredRequirementIds: string[] } | null>(null)

  // Repart de zéro à chaque changement d'analyse active (choisie dans le panel Version).
  useEffect(() => {
    setCampaignDraft(null)
  }, [activeAnalysisId])

  const generateCampaignMutation = useMutation({
    mutationFn: async (vars: { analysisId: string; label: string; nodes: ImpactNode[] }) => {
      const directTestIds = new Set<string>()
      const requirementIds = new Set<string>()
      for (const n of vars.nodes) {
        if (!TO_TEST_STATUSES.has(n.status)) continue
        if (n.elementType === 'test_case') directTestIds.add(n.elementId)
        else requirementIds.add(n.elementId)
      }

      let uncoveredRequirementIds: string[] = []
      if (requirementIds.size > 0) {
        const plan = await api.traceability.testPlan(repoPath, {
          title: vars.label,
          requirementIds: [...requirementIds],
          testCaseFilter: 'approved_only',
          coverageFilter: 'all',
        })
        plan.testCaseRefs.forEach((id) => directTestIds.add(id))
        uncoveredRequirementIds = plan.uncoveredRequirementIds
      }
      return { analysisId: vars.analysisId, testCaseIds: [...directTestIds], uncoveredRequirementIds }
    },
    onSuccess: (result) => {
      // Ignore une réponse tardive si l'utilisateur a changé d'analyse entre-temps.
      if (result.analysisId !== activeAnalysisId) return
      setCampaignDraft(result)
    },
  })

  function generateCampaign() {
    if (!activeAnalysisId || !activeAnalysis) return
    generateCampaignMutation.mutate({ analysisId: activeAnalysisId, label: activeAnalysis.label, nodes: allNodes })
  }

  function goToCreateCampaign() {
    if (!campaignDraft || !activeAnalysis) return
    navigate({
      to: '/campaign/new',
      search: {
        ...elementSearch,
        title: `Vérification impact — ${activeAnalysis.label}`,
        testCaseIds: campaignDraft.testCaseIds.join(','),
      },
    })
  }

  // Base commune des search params attendus par /campaign/new (les exigences/tests s'ouvrent
  // désormais dans un popup plutôt qu'en navigant vers /req ou /test — retour plus naturel :
  // on referme le popup et on reste sur l'analyse d'impact au lieu de perdre le contexte de
  // scroll/filtre via l'historique de navigation).
  const elementSearch = { repoPath, projectId, component: undefined, level: undefined }

  const [quickEdit, setQuickEdit] = useState<{ type: 'requirement' | 'test_case'; id: string } | null>(null)

  function openRequirement(reqId: string) {
    setQuickEdit({ type: 'requirement', id: reqId })
  }

  function openElement(node: ImpactNode) {
    setQuickEdit({ type: node.elementType, id: node.elementId })
  }

  const closedCount = allNodes.filter((n) => CLOSED_STATUSES.has(n.status)).length
  const openCount = allNodes.length - closedCount
  const toTestCount = allNodes.filter((n) => TO_TEST_STATUSES.has(n.status)).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={
          activeAnalysis
            ? <span className="font-mono">{activeAnalysis.fromBaseline.tag} → {activeAnalysis.toBaseline.tag}</span>
            : "Analyse d'impact"
        }
        subtitle={activeAnalysis?.label}
        actions={
          activeAnalysis && (
            <>
              <ExportButton
                kind="impact-analysis"
                formats={['xlsx', 'pdf']}
                repoPath={repoPath}
                getSuggestedBaseName={() =>
                  impactAnalysisExportBaseName(activeAnalysis.fromBaseline.tag, activeAnalysis.toBaseline.tag)
                }
                getPayload={() => ({ analysis: activeAnalysis })}
                getPrintParams={() => ({ repoPath, analysisId: activeAnalysis.id })}
              />
              {allNodes.length > 0 && (
                openCount === 0 ? (
                  <span className="text-xs text-green-600 font-medium shrink-0">Tous les impacts maîtrisés</span>
                ) : (
                  <span className="text-xs text-ink-3 shrink-0">{openCount} ouvert(s) / {allNodes.length} au total</span>
                )
              )}
              {toTestCount > 0 && (
                <button
                  type="button"
                  onClick={generateCampaign}
                  disabled={generateCampaignMutation.isPending}
                  className="btn-secondary text-xs px-3 py-1.5 shrink-0 disabled:opacity-50"
                >
                  {generateCampaignMutation.isPending ? 'Génération…' : `Générer une campagne (${toTestCount})`}
                </button>
              )}
            </>
          )
        }
      />

      {/* Brouillon de campagne générée */}
      {campaignDraft && activeAnalysis && (
        <div className="px-4 py-2 border-b border-edge-subtle shrink-0 flex items-center gap-3 bg-hover">
          <p className="text-xs text-ink">
            {campaignDraft.testCaseIds.length} TestCase(s) trouvé(s)
          </p>
          {campaignDraft.uncoveredRequirementIds.length > 0 && (
            <p className="text-xs text-amber-500">
              {campaignDraft.uncoveredRequirementIds.length} exigence(s) non couverte(s) : {campaignDraft.uncoveredRequirementIds.join(', ')}
            </p>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={goToCreateCampaign}
            disabled={campaignDraft.testCaseIds.length === 0}
            className="btn-primary text-xs px-3 py-1.5 shrink-0 disabled:opacity-50"
          >
            Créer la campagne
          </button>
        </div>
      )}

      {/* Liste des exigences impactées, en grand */}
      <div className="flex-1 overflow-y-auto">
        {!activeAnalysisId ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-ink-3 italic px-6 text-center">
              Sélectionnez deux baselines dans le panel Version pour analyser l'impact des modifications, ou rouvrez une analyse existante.
            </p>
          </div>
        ) : isLoadingAnalysis ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">Chargement…</p>
        ) : !activeAnalysis || activeAnalysis.changedRequirements.length === 0 ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">Aucune exigence modifiée entre ces deux baselines.</p>
        ) : (
          <div>
            {activeAnalysis.changedRequirements.map((cr) => (
              <ChangedRequirementRow
                key={cr.reqId}
                changed={cr}
                repoPath={repoPath}
                onOpenRequirement={openRequirement}
                onOpenElement={openElement}
                onUpdateItemStatus={updateItemStatus}
              />
            ))}
          </div>
        )}
      </div>

      {quickEdit?.type === 'requirement' && (
        <RequirementEditModal repoPath={repoPath} reqId={quickEdit.id} onClose={() => setQuickEdit(null)} />
      )}
      {quickEdit?.type === 'test_case' && (
        <TestCaseEditModal repoPath={repoPath} testId={quickEdit.id} onClose={() => setQuickEdit(null)} />
      )}
    </div>
  )
}
