import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedRequirement, ImpactAnalysisStatus, ImpactNode, Requirement, RequirementChangeType } from '@polenta/types'
import { api } from '../../api'
import { STATUS_LABEL_KEY } from '../../lib/impactStatus'
import { wordDiff, diffValueText } from '../../lib/wordDiff'
import { RevalidationFlag } from '../system/RevalidationFlag'
import { RepoBadge } from './RepoBadge'
import { useProjectSchema } from '../../hooks/useProjectSchema'

// Arbres d'impact (SPEC-TRACEABILITY §4.6) et levée du flag needsRevalidation (§4.8), partagés par
// l'analyse d'un change (GH199) et l'analyse des modifications locales (§4.7). Extraits de l'ancienne
// page /impact-analysis.

// ── Libellés ─────────────────────────────────────────────────────────────────

/** T111 — retournent des clés de traduction (convention module-scope), résolues via
 *  t() par l'appelant. */
export const CHANGE_TYPE_LABEL_KEY: Record<RequirementChangeType, string> = {
  added: 'impactAnalysisPage.changeType.added',
  removed: 'impactAnalysisPage.changeType.removed',
  modified: 'impactAnalysisPage.changeType.modified',
}

export const CHANGE_TYPE_COLOR: Record<RequirementChangeType, string> = {
  added: 'text-status-success',
  removed: 'text-status-danger',
  modified: 'text-status-warning',
}

export const STATUS_ORDER: ImpactAnalysisStatus[] = [
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
export const CLOSED_STATUSES = new Set<ImpactAnalysisStatus>(['pas_d_impact_reel', 'impact_teste', 'modification_verifiee'])

// ── Parcours de l'arbre ──────────────────────────────────────────────────────

export function flattenNodes(nodes: ImpactNode[]): ImpactNode[] {
  const result: ImpactNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...flattenNodes(node.children))
  }
  return result
}


// ── Levée du flag needsRevalidation (T173) ───────────────────────────────────

/** État partagé par tous les nœuds d'arbre : quels éléments sont marqués (lecture live, même
 *  pour une analyse figée), sélection multiple (par id, dédupliquée entre occurrences) et levée
 *  unitaire. Contexte plutôt que props : l'arbre est récursif sur trois composants. */
export interface RevalidationTreeState {
  flaggedIds: Set<string>
  selected: Set<string>
  toggle: (id: string) => void
  clear: (ids: string[]) => void
  pending: boolean
}

export const RevalidationTreeContext = createContext<RevalidationTreeState>({
  flaggedIds: new Set(),
  selected: new Set(),
  toggle: () => {},
  clear: () => {},
  pending: false,
})

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

export type UpdateNodeStatus = (node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) => void

interface ImpactTreeViewProps {
  nodes: ImpactNode[]
  repoPath: string
  onOpen: (node: ImpactNode) => void
  onUpdateStatus: UpdateNodeStatus
  depth?: number
  /** T175 — analyse locale : pas de statut ni de commentaire. */
  readOnly?: boolean
}

// L'énoncé EARS courant d'une exigence n'est pas assez court pour tenir dans la liste — la
// ligne affiche le titre, l'énoncé complet reste consultable au survol (tooltip natif, id ou
// titre) et dans le popup en lecture seule (RequirementEditModal). Partage la clé de query avec
// ce popup pour profiter du cache déjà chaud si l'utilisateur l'a ouvert.
export function useRequirementStatementTooltip(repoPath: string, reqId: string, fallback: string): string {
  const { data: req } = useQuery<Requirement>({
    queryKey: ['requirement', repoPath, reqId],
    queryFn: () => api.requirements.get(repoPath, reqId),
    enabled: !!repoPath && !!reqId,
  })
  const rawStatement = req?.fields ? (req.fields as Record<string, unknown>)['statement'] : undefined
  return (typeof rawStatement === 'string' && rawStatement.trim() ? rawStatement : fallback).replace(/\s+/g, ' ').trim()
}

function ImpactNodeStatusEditor({ node, onUpdateStatus }: { node: ImpactNode; onUpdateStatus: UpdateNodeStatus }) {
  const { t } = useTranslation()
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
        placeholder={t('impactAnalysisPage.commentPlaceholder')}
        rows={1}
        className="w-1/4 shrink-0 resize-none text-xs bg-surface border border-edge-subtle rounded px-1.5 py-1 text-ink leading-4"
      />
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          CLOSED_STATUSES.has(draft.status) ? 'bg-status-success-solid' : 'bg-transparent'
        }`}
        title={CLOSED_STATUSES.has(draft.status) ? t('impactAnalysisPage.riskLifted') : undefined}
      />
      <select
        value={draft.status}
        onChange={(e) => commitStatus(e.target.value as ImpactAnalysisStatus)}
        className={`shrink-0 text-xs bg-surface border rounded px-1.5 py-1 text-ink max-w-[9rem] ${
          CLOSED_STATUSES.has(draft.status) ? 'border-status-success' : 'border-edge-subtle'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>{t(STATUS_LABEL_KEY[s])}</option>
        ))}
      </select>
    </>
  )
}

function ImpactTreeNodeRow({ node, repoPath: analysisRepoPath, onOpen, onUpdateStatus, depth, readOnly }: { node: ImpactNode; repoPath: string; onOpen: (node: ImpactNode) => void; onUpdateStatus: UpdateNodeStatus; depth: number; readOnly?: boolean }) {
  const repoPath = node.repo?.path ?? analysisRepoPath
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const badge = node.elementType === 'requirement' ? 'EX' : 'TC'
  const isRequirement = node.elementType === 'requirement'
  // Le hook est toujours appelé (règle des hooks) ; sa query interne reste désactivée pour un
  // test_case — le résultat retombe alors simplement sur `node.title`.
  const statementTooltip = useRequirementStatementTooltip(isRequirement ? repoPath : '', isRequirement ? node.elementId : '', node.title)
  const tooltip = isRequirement ? statementTooltip : node.title
  const { t } = useTranslation()
  const revalidation = useContext(RevalidationTreeContext)
  const flagged = revalidation.flaggedIds.has(node.elementId)
  // Libellé du lien dans sa direction, vu du parent (« est implémentée par », « est vérifiée par »…).
  const { data: schema } = useProjectSchema(analysisRepoPath)
  const linkType = schema?.linkTypes?.find(l => l.name === node.linkType)
  const relation = node.parentIsTarget === undefined ? null
    : (node.parentIsTarget ? linkType?.labelTargetToSource : linkType?.labelSourceToTarget) || node.linkType

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 text-sm hover:bg-hover rounded transition-colors group"
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
        data-testid={`impact-node-${node.elementId}`}
      >
        {hasChildren ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="text-ink-3 shrink-0">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {flagged && (
          <input
            type="checkbox"
            checked={revalidation.selected.has(node.elementId)}
            onChange={() => revalidation.toggle(node.elementId)}
            className="shrink-0"
            aria-label={t('impactAnalysisPage.revalidation.select', { id: node.elementId })}
          />
        )}
        {relation && <span className="text-xs text-ink-3 italic shrink-0" data-testid={`impact-relation-${node.elementId}`}>{relation}</span>}
        <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{badge}</span>
        <button
          type="button"
          onClick={() => onOpen(node)}
          className="font-mono text-ink truncate hover:underline text-left"
          title={tooltip}
        >
          {node.elementId}
        </button>
        <RevalidationFlag show={flagged} />
        <span className="text-ink-2 truncate min-w-0 flex-1" title={tooltip}>
          {node.title}
        </span>
        <RepoBadge repo={node.repo} />
        {flagged && (
          <button
            type="button"
            onClick={() => revalidation.clear([node.elementId])}
            disabled={revalidation.pending}
            className="btn-secondary-sm shrink-0"
          >
            {t('impactAnalysisPage.revalidation.clear')}
          </button>
        )}
        {!readOnly && <ImpactNodeStatusEditor node={node} onUpdateStatus={onUpdateStatus} />}
      </div>
      {hasChildren && expanded && (
        <ImpactTreeView nodes={node.children} repoPath={analysisRepoPath} onOpen={onOpen} onUpdateStatus={onUpdateStatus} depth={depth + 1} readOnly={readOnly} />
      )}
    </div>
  )
}

export function ImpactTreeView({ nodes, repoPath, onOpen, onUpdateStatus, depth = 0, readOnly }: ImpactTreeViewProps) {
  if (nodes.length === 0) return null
  return (
    <div>
      {nodes.map((node) => (
        <ImpactTreeNodeRow key={`${node.elementType}-${node.elementId}`} node={node} repoPath={repoPath} onOpen={onOpen} onUpdateStatus={onUpdateStatus} depth={depth} readOnly={readOnly} />
      ))}
    </div>
  )
}

// ── StatementDiff ────────────────────────────────────────────────────────────

/** Au-delà, le diff est replié par défaut (un énoncé EARS tient d'ordinaire en quelques lignes). */
const STATEMENT_DIFF_COLLAPSE_CHARS = 400

// GH145 — avant/après de l'énoncé d'un élément modifié, mot à mot : ancien barré, nouveau
// surligné. C'est presque toujours ce qui a changé, et ce qui permet de juger l'impact sur l'arbre.
function StatementDiff({ from, to }: { from: unknown; to: unknown }) {
  const { t } = useTranslation()
  const before = diffValueText(from)
  const after = diffValueText(to)
  const parts = useMemo(() => wordDiff(before, after), [before, after])
  const long = Math.max(before.length, after.length) > STATEMENT_DIFF_COLLAPSE_CHARS
  const [open, setOpen] = useState(!long)
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-ink-3 hover:text-ink-2">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {t('impactAnalysisPage.statementDiff')}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap text-ink-2 border-l-2 border-edge pl-2" data-testid="statement-diff">
          {parts.map((p, i) => p.kind === 'same'
            ? <span key={i}>{p.text}</span>
            : p.kind === 'removed'
              ? <del key={i} className="text-status-danger bg-status-danger-bg line-through">{p.text}</del>
              : <ins key={i} className="text-status-success bg-status-success-bg no-underline">{p.text}</ins>)}
        </p>
      )}
    </div>
  )
}

// ── ChangedRequirementRow ────────────────────────────────────────────────────

export function ChangedRequirementRow({
  changed,
  repoPath: analysisRepoPath,
  onOpenChanged,
  onOpenElement,
  onUpdateItemStatus,
  readOnly,
}: {
  changed: ChangedRequirement
  repoPath: string
  onOpenChanged: (changed: ChangedRequirement) => void
  onOpenElement: (node: ImpactNode) => void
  onUpdateItemStatus: (reqId: string, direction: 'descendant' | 'ascendant', node: ImpactNode, status: ImpactAnalysisStatus, comment: string | null) => void
  readOnly?: boolean
}) {
  // T175 — un élément changé peut être un test, et vivre dans un composant.
  const isRequirement = (changed.elementType ?? 'requirement') === 'requirement'
  const repoPath = changed.repo?.path ?? analysisRepoPath
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const hasTrees = changed.descendantTree.length > 0 || changed.ascendantTree.length > 0
  const onUpdateDescendant: UpdateNodeStatus = (node, status, comment) => onUpdateItemStatus(changed.reqId, 'descendant', node, status, comment)
  const onUpdateAscendant: UpdateNodeStatus = (node, status, comment) => onUpdateItemStatus(changed.reqId, 'ascendant', node, status, comment)
  // L'énoncé a son propre affichage, mot à mot (GH145) — retiré de la liste brute des champs changés.
  const statementChange = changed.changedFields.find((f) => f.field === 'fields.statement')
  const changedFields = changed.changedFields.filter((f) => f.field !== 'fields.statement')
  const statementTooltip = useRequirementStatementTooltip(isRequirement ? repoPath : '', isRequirement ? changed.reqId : '', changed.title)
  // T173 — l'élément changé n'est normalement pas marqué (T171 `includeSelf` excepté) : icône
  // seule, la levée se fait depuis la liste de repli.
  const { flaggedIds } = useContext(RevalidationTreeContext)

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
        {changed.elementType && (
          <span className="font-mono text-[10px] text-ink-3 border border-edge-subtle rounded px-1 shrink-0">{isRequirement ? 'EX' : 'TC'}</span>
        )}
        <button
          type="button"
          onClick={() => onOpenChanged(changed)}
          className="font-mono text-ink font-medium truncate hover:underline text-left"
          title={statementTooltip}
        >
          {changed.reqId}
        </button>
        <RevalidationFlag show={flaggedIds.has(changed.reqId)} />
        <span className="text-ink-2 truncate flex-1" title={statementTooltip}>{changed.title}</span>
        <RepoBadge repo={changed.repo} />
        <span className={`text-xs font-medium shrink-0 ${CHANGE_TYPE_COLOR[changed.changeType]}`}>
          {t(CHANGE_TYPE_LABEL_KEY[changed.changeType])}
        </span>
      </div>

      {statementChange && (
        <div className="px-10 pb-2">
          <StatementDiff from={statementChange.from} to={statementChange.to} />
        </div>
      )}

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
            <ImpactTreeView nodes={changed.descendantTree} repoPath={analysisRepoPath} onOpen={onOpenElement} onUpdateStatus={onUpdateDescendant} depth={1} readOnly={readOnly} />
          )}
          {changed.ascendantTree.length > 0 && (
            <ImpactTreeView nodes={changed.ascendantTree} repoPath={analysisRepoPath} onOpen={onOpenElement} onUpdateStatus={onUpdateAscendant} depth={1} readOnly={readOnly} />
          )}
        </div>
      )}
    </div>
  )
}
