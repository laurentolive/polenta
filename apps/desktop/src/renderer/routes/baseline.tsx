import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, Layers, ChevronDown, ChevronRight, RefreshCw, CircleCheck, CircleAlert, Plus, Trash2, Search } from 'lucide-react'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { ViewHeader } from '../components/layout/ViewHeader'
import type { BaselineRecord, BaselineComponentRef, SyncStatus } from '@polenta/api-client'
import type { WorkspaceTreeNode } from '@polenta/types'

export const Route = createFileRoute('/baseline')({
  component: BaselinePage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

// ── helpers ──────────────────────────────────────────────────────────────────

function nextTag(tags: string[]): string {
  if (tags.length === 0) return 'v1.0.0'
  const sorted = [...tags].sort((a, b) => {
    const ap = a.replace(/^v/, '').split('.').map(Number)
    const bp = b.replace(/^v/, '').split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      const diff = (ap[i] ?? 0) - (bp[i] ?? 0)
      if (diff !== 0) return diff
    }
    return 0
  })
  const last = sorted[sorted.length - 1]
  const m = last.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/)
  if (m) return `${m[1]}${m[2]}.${m[3]}.${Number(m[4]) + 1}`
  return last
}

// ── Repo readiness (T79: état des repos avant création multi-composant) ────────

interface RepoReadiness {
  node: WorkspaceTreeNode
  status: SyncStatus | undefined
  integrationBranch: string | undefined
  tags: string[] | undefined
  loading: boolean
}

/**
 * Non-null reason string when the repo blocks baseline creation, null when it's ready.
 *
 * T46: n'importe quelle branche peut être baselinée (ex. une branche `dev-*` en cours, pour
 * mesurer l'impact d'une modification avant de la livrer) — seule une modification en attente
 * (staged/unstaged) bloque encore la création. Le repo n'a plus besoin d'être sur sa branche
 * d'intégration configurée (T79 le bloquait ; incompatible avec ce besoin).
 */
function readinessIssue(r: RepoReadiness): string | null {
  if (r.loading) return null
  if (!r.status) return 'état illisible'
  if (r.status.staged.length + r.status.unstaged.length > 0) return 'modifications en attente'
  return null
}

function RepoReadinessRow({ readiness }: { readiness: RepoReadiness }) {
  const issue = readinessIssue(readiness)
  return (
    <li className="flex items-center gap-2 px-2 py-1 text-xs">
      {readiness.loading ? (
        <span className="w-3.5 h-3.5 shrink-0" />
      ) : issue ? (
        <CircleAlert size={14} className="text-red-500 shrink-0" />
      ) : (
        <CircleCheck size={14} className="text-green-600 shrink-0" />
      )}
      <span className="font-mono text-ink truncate">{readiness.node.name}</span>
      {!readiness.loading && readiness.status && (
        <span
          className="text-ink-3 font-mono truncate"
          title={
            readiness.integrationBranch && readiness.status.branch !== readiness.integrationBranch
              ? `Branche d'intégration configurée : "${readiness.integrationBranch}"`
              : 'Branche courante'
          }
        >
          {readiness.status.branch}
          {readiness.integrationBranch && readiness.status.branch !== readiness.integrationBranch && (
            <span className="text-amber-500"> (hors intégration)</span>
          )}
        </span>
      )}
      <span className="ml-auto text-ink-3 truncate">
        {readiness.loading ? '…' : issue ?? 'prêt'}
      </span>
    </li>
  )
}

// ── BaselineItem (collapsible) ────────────────────────────────────────────────

function BaselineItem({ baseline, onDelete }: { baseline: BaselineRecord; onDelete: (baseline: BaselineRecord) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <li>
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-hover transition-colors group">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          {open ? <ChevronDown size={11} className="text-ink-3 shrink-0" /> : <ChevronRight size={11} className="text-ink-3 shrink-0" />}
          <Layers size={11} className="text-ink-3 shrink-0" />
          <span className="font-mono text-ink shrink-0">{baseline.tag}</span>
          {baseline.message && <span className="text-ink-3 truncate">{baseline.message}</span>}
        </button>
        <span className="text-ink-3 font-sans shrink-0">
          {new Date(baseline.createdAt).toLocaleDateString('fr-FR')}
        </span>
        <button
          type="button"
          onClick={() => onDelete(baseline)}
          className="p-1 rounded text-ink-3 hover:text-red-500 hover:bg-hover transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          title="Supprimer la baseline"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {open && baseline.components.length > 0 && (
        <ul className="ml-6 mb-1 space-y-0.5">
          {baseline.components.map(comp => (
            <li key={comp.name} className="flex items-center gap-2 px-2 py-1 text-xs text-ink-3">
              <span className="font-mono truncate">{comp.name}</span>
              <span className="ml-auto flex items-center gap-1 shrink-0">
                <Tag size={10} className="text-amber-500" />
                <span className="font-mono text-ink">{comp.tag}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && baseline.components.length === 0 && (
        <p className="ml-6 mb-1 px-2 py-1 text-xs text-ink-3 italic">Pas de composants.</p>
      )}
    </li>
  )
}

// ── CreateBaselineModal ────────────────────────────────────────────────────────

interface CreateBaselineModalProps {
  repoReadiness: RepoReadiness[]
  structureError: string | null
  structureConflicts: unknown[] | null
  readinessLoading: boolean
  blockingRepos: RepoReadiness[]
  refreshReadiness: () => void
  mainTag: string
  setMainTagOverride: (v: string) => void
  message: string
  setMessage: (v: string) => void
  baselines: BaselineRecord[]
  mainTags: string[]
  tagConflictNodes: RepoReadiness[]
  mainTagValid: boolean
  repoPath: string
  tagWarning: string | null
  isPending: boolean
  isError: boolean
  errorMessage: string | null
  onCreate: () => void
  onClose: () => void
}

function CreateBaselineModal({
  repoReadiness, structureError, structureConflicts, readinessLoading, blockingRepos, refreshReadiness,
  mainTag, setMainTagOverride, message, setMessage, baselines, mainTags, tagConflictNodes, mainTagValid,
  repoPath, tagWarning, isPending, isError, errorMessage, onCreate, onClose,
}: CreateBaselineModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink">Nouvelle baseline</h2>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="rounded-lg border border-edge p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="section-label">État des repos</span>
              <button
                type="button"
                onClick={refreshReadiness}
                className="p-0.5 rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors"
                title="Rafraîchir"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {structureError ? (
              <p className="text-xs text-red-500 leading-snug">{structureError}</p>
            ) : structureConflicts && structureConflicts.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                Conflit de dépendances à résoudre avant de créer une baseline — ouvrez l'onglet
                Structure du Modèle de données pour le résoudre.
              </p>
            ) : readinessLoading ? (
              <p className="text-xs text-ink-3 italic">Vérification…</p>
            ) : (
              <ul className="space-y-0.5">
                {repoReadiness.map(r => (
                  <RepoReadinessRow key={r.node.repoPath} readiness={r} />
                ))}
              </ul>
            )}
            {!structureError && !structureConflicts?.length && !readinessLoading && blockingRepos.length > 0 && (
              <p className="mt-1.5 text-xs text-red-500 leading-snug">
                Création bloquée : {blockingRepos.length} repo(s) avec des modifications en attente.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-edge p-3">
            <label className="block text-xs text-ink-3 mb-1">Tag repo principal</label>
            <input
              type="text"
              value={mainTag}
              onChange={e => setMainTagOverride(e.target.value)}
              placeholder="v1.0.0"
              className="w-full input-field text-xs py-1 font-mono"
            />
            {baselines.some(b => b.tag === mainTag.trim()) && (
              <p className="mt-1 text-xs text-red-500">Ce tag est déjà utilisé par une baseline existante.</p>
            )}
            {mainTags.includes(mainTag.trim()) && (
              <p className="mt-1 text-xs text-amber-500">Ce tag git existe déjà sur le repo.</p>
            )}
            {tagConflictNodes.length > 0 && (
              <p className="mt-1 text-xs text-amber-500">
                Ce tag git existe déjà sur : {tagConflictNodes.map(r => r.node.name).join(', ')}.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-edge p-3">
            <label className="block text-xs text-ink-3 mb-1">Message (optionnel)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Décrire cette baseline…"
              rows={3}
              className="w-full input-field text-xs resize-none"
            />
          </div>

          {isError && (
            <p className="text-xs text-red-500">
              {errorMessage ?? 'Erreur lors de la création'}
            </p>
          )}

          {tagWarning && (
            <p className="text-xs text-amber-500 leading-snug">{tagWarning}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={!mainTagValid || isPending || !repoPath || readinessLoading || blockingRepos.length > 0}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? 'Création…' : 'Créer la baseline'}
          </button>
        </div>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">Supprimer la baseline {baseline.tag} ?</h2>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-ink-2 leading-snug">
            Supprime le tag <code className="text-ink-3">{baseline.tag}</code> sur le repo principal
            {baseline.components.length > 0 && ` et sur ${baseline.components.length} composant(s)`}. Cette action est irréversible.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
          >
            {isDeleting ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── BaselinePage ──────────────────────────────────────────────────────────────

function BaselinePage() {
  const { projectId } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const workspaceDir = decodeProjectId(projectId)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  const { flatNodes, error: structureError, conflicts: structureConflicts } = useWorkspaceStructure(workspaceDir, repoPath)
  const componentNodes = flatNodes.filter(n => n.repoPath !== repoPath)

  const { data: mainTags = [] } = useQuery({
    queryKey: ['sync:tags', repoPath],
    queryFn: () => api.sync.tags(repoPath),
    enabled: !!repoPath,
  })

  const componentRefs: BaselineComponentRef[] = componentNodes.map(n => ({ name: n.name, repoPath: n.repoPath }))

  const { data: baselines = [] } = useQuery({
    queryKey: ['baseline:list', repoPath, componentRefs],
    queryFn: () => api.baseline.list(repoPath, componentRefs),
    enabled: !!repoPath,
  })

  // T79: readiness of every repo in the workspace (root included) — a baseline can only be
  // created once every repo is on its configured integration branch with no pending changes.
  const statusQueries = useQueries({
    queries: flatNodes.map(node => ({
      queryKey: ['sync:status', node.repoPath],
      queryFn: () => api.sync.status(node.repoPath),
      enabled: !!node.repoPath,
    })),
  })
  const integrationBranchQueries = useQueries({
    queries: flatNodes.map(node => ({
      queryKey: ['baseline:integration-branch', node.repoPath],
      queryFn: () => api.baseline.getIntegrationBranch(node.repoPath),
      enabled: !!node.repoPath,
    })),
  })
  const tagsQueries = useQueries({
    queries: flatNodes.map(node => ({
      queryKey: ['sync:tags', node.repoPath],
      queryFn: () => api.sync.tags(node.repoPath),
      enabled: !!node.repoPath,
    })),
  })

  const repoReadiness: RepoReadiness[] = flatNodes.map((node, i) => ({
    node,
    status: statusQueries[i].data,
    integrationBranch: integrationBranchQueries[i].data,
    tags: tagsQueries[i].data,
    loading: statusQueries[i].isLoading || integrationBranchQueries[i].isLoading || tagsQueries[i].isLoading,
  }))
  const readinessLoading = repoReadiness.length === 0 || repoReadiness.some(r => r.loading)
  const blockingRepos = repoReadiness.filter(r => readinessIssue(r) !== null)

  function refreshReadiness() {
    // Prefix match (default react-query behavior): invalidates every repo's entry in one call.
    qc.invalidateQueries({ queryKey: ['sync:status'] })
    qc.invalidateQueries({ queryKey: ['baseline:integration-branch'] })
    qc.invalidateQueries({ queryKey: ['sync:tags'] })
  }

  const [mainTagOverride, setMainTagOverride] = useState<string | null>(null)
  const mainTag = mainTagOverride ?? nextTag(mainTags)
  const [message, setMessage] = useState('')

  const tagConflictNodes = repoReadiness.filter(r => (r.tags ?? []).includes(mainTag.trim()))
  const mainTagValid =
    mainTag.trim() !== '' &&
    !baselines.some(b => b.tag === mainTag.trim()) &&
    tagConflictNodes.length === 0

  const [tagWarning, setTagWarning] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => {
      const components = componentNodes.map(n => ({ name: n.name, tag: mainTag.trim(), createTag: true }))
      return api.baseline.create(repoPath, { tag: mainTag.trim(), message: message.trim(), components }, workspaceDir)
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ['baseline:list', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:tags'] })
      setMainTagOverride(null)
      setMessage('')
      setShowCreateModal(false)
      setTagWarning(
        record.components.length < componentNodes.length
          ? `${componentNodes.length - record.components.length} composant(s) n'ont pas pu être tagués — vérifier les logs.`
          : null,
      )
    },
  })

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
  const filteredBaselines = baselines.filter(b => {
    const needle = filterText.trim().toLowerCase()
    if (!needle) return true
    return b.tag.toLowerCase().includes(needle) || b.message.toLowerCase().includes(needle)
  })

  const isLoading = !project

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{ onClick: () => navigate({ to: '/graph', search: { projectId, sha: undefined } }) }}
        title={
          <span className="flex items-center gap-2">
            <Tag size={14} className="text-prim" />
            Baselines
          </span>
        }
        actions={
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            disabled={!repoPath}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 shadow disabled:opacity-50"
          >
            <Plus size={12} />
            Nouvelle baseline
          </button>
        }
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="shrink-0 px-6 py-3 border-b border-edge">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder="Filtrer par tag ou message…"
              className="input-field w-full text-xs py-1.5 pl-7"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="text-sm text-ink-3">Chargement…</p>
          ) : baselines.length === 0 ? (
            <p className="text-xs text-ink-3 italic">Aucune baseline.</p>
          ) : filteredBaselines.length === 0 ? (
            <p className="text-xs text-ink-3 italic">Aucune baseline ne correspond au filtre.</p>
          ) : (
            <ul className="max-w-2xl divide-y divide-edge border border-edge rounded-lg overflow-hidden">
              {filteredBaselines.map(b => (
                <BaselineItem key={b.tag} baseline={b} onDelete={setDeletingBaseline} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateBaselineModal
          repoReadiness={repoReadiness}
          structureError={structureError}
          structureConflicts={structureConflicts}
          readinessLoading={readinessLoading}
          blockingRepos={blockingRepos}
          refreshReadiness={refreshReadiness}
          mainTag={mainTag}
          setMainTagOverride={setMainTagOverride}
          message={message}
          setMessage={setMessage}
          baselines={baselines}
          mainTags={mainTags}
          tagConflictNodes={tagConflictNodes}
          mainTagValid={mainTagValid}
          repoPath={repoPath}
          tagWarning={tagWarning}
          isPending={createMutation.isPending}
          isError={createMutation.isError}
          errorMessage={createMutation.error instanceof Error ? createMutation.error.message : null}
          onCreate={() => createMutation.mutate()}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {deletingBaseline && (
        <DeleteBaselineModal
          baseline={deletingBaseline}
          isDeleting={deleteMutation.isPending}
          error={deleteMutation.error instanceof Error ? deleteMutation.error.message : null}
          onConfirm={() => deleteMutation.mutate(deletingBaseline)}
          onClose={() => setDeletingBaseline(null)}
        />
      )}
    </div>
  )
}
