import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag, RefreshCw, CircleCheck, CircleAlert } from 'lucide-react'
import { api } from '../api'
import { useBaselines } from '../hooks/useBaselines'
import { ViewHeader } from '../components/layout/ViewHeader'
import type { BaselineRecord, SyncStatus } from '@polenta/api-client'
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
/** T111 — retourne une clé de traduction (convention module-scope), résolue via t()
 *  par l'appelant. */
function readinessIssueKey(r: RepoReadiness): string | null {
  if (r.loading) return null
  if (!r.status) return 'baselinePage.readiness.unreadableState'
  if (r.status.staged.length + r.status.unstaged.length > 0) return 'baselinePage.readiness.pendingChanges'
  return null
}

function RepoReadinessRow({ readiness }: { readiness: RepoReadiness }) {
  const { t } = useTranslation()
  const issueKey = readinessIssueKey(readiness)
  const issue = issueKey ? t(issueKey) : null
  return (
    <li className="flex items-center gap-2 px-2 py-1 text-xs">
      {readiness.loading ? (
        <span className="w-3.5 h-3.5 shrink-0" />
      ) : issue ? (
        <CircleAlert size={14} className="text-status-danger shrink-0" />
      ) : (
        <CircleCheck size={14} className="text-status-success shrink-0" />
      )}
      <span className="font-mono text-ink truncate">{readiness.node.name}</span>
      {!readiness.loading && readiness.status && (
        <span
          className="text-ink-3 font-mono truncate"
          title={
            readiness.integrationBranch && readiness.status.branch !== readiness.integrationBranch
              ? t('baselinePage.readiness.integrationBranchConfigured', { branch: readiness.integrationBranch })
              : t('baselinePage.readiness.currentBranch')
          }
        >
          {readiness.status.branch}
          {readiness.integrationBranch && readiness.status.branch !== readiness.integrationBranch && (
            <span className="text-status-warning"> {t('baselinePage.readiness.outOfIntegration')}</span>
          )}
        </span>
      )}
      <span className="ml-auto text-ink-3 truncate">
        {readiness.loading ? '…' : issue ?? t('baselinePage.readiness.ready')}
      </span>
    </li>
  )
}

// ── CreateBaselineForm (GH40: ex-popup, rendue directement dans la vue) ───────

interface CreateBaselineFormProps {
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
  canCreate: boolean
  createdTag: string | null
  tagWarning: string | null
  isPending: boolean
  isError: boolean
  errorMessage: string | null
  onCreate: () => void
}

function CreateBaselineForm({
  repoReadiness, structureError, structureConflicts, readinessLoading, blockingRepos, refreshReadiness,
  mainTag, setMainTagOverride, message, setMessage, baselines, mainTags, tagConflictNodes, canCreate,
  createdTag, tagWarning, isPending, isError, errorMessage, onCreate,
}: CreateBaselineFormProps) {
  const { t } = useTranslation()
  return (
    // Ctrl/Cmd+Entrée = créer. Pas d'Entrée seule (le champ tag déclencherait une création
    // involontaire) ni d'Échap (plus de popup à fermer).
    <div
      className="max-w-2xl space-y-4"
      onKeyDown={e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCreate) {
          e.preventDefault()
          onCreate()
        }
      }}
    >
      {createdTag && (
        <p className="flex items-center gap-1.5 text-xs text-status-success">
          <CircleCheck size={14} className="shrink-0" />
          {t('baselinePage.baselineCreated', { tag: createdTag })}
        </p>
      )}

      <div className="rounded-lg border border-edge p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="section-label">{t('baselinePage.repoStateLabel')}</span>
          <button
            type="button"
            onClick={refreshReadiness}
            className="p-0.5 rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors"
            title={t('baselinePage.refresh')}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        {structureError ? (
          <p className="text-xs text-status-danger leading-snug">{structureError}</p>
        ) : structureConflicts && structureConflicts.length > 0 ? (
          <p className="text-xs text-status-warning leading-snug">
            {t('baselinePage.dependencyConflictHint')}
          </p>
        ) : readinessLoading ? (
          <p className="text-xs text-ink-3 italic">{t('baselinePage.checking')}</p>
        ) : (
          <ul className="space-y-0.5">
            {repoReadiness.map(r => (
              <RepoReadinessRow key={r.node.repoPath} readiness={r} />
            ))}
          </ul>
        )}
        {!structureError && !structureConflicts?.length && !readinessLoading && blockingRepos.length > 0 && (
          <p className="mt-1.5 text-xs text-status-danger leading-snug">
            {t('baselinePage.creationBlocked', { count: blockingRepos.length })}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-edge p-3">
        <label className="block text-xs text-ink-3 mb-1">{t('baselinePage.mainRepoTagLabel')}</label>
        <input
          type="text"
          value={mainTag}
          onChange={e => setMainTagOverride(e.target.value)}
          placeholder="v1.0.0"
          className="w-full input-field text-xs py-1 font-mono"
        />
        {baselines.some(b => b.tag === mainTag.trim()) && (
          <p className="mt-1 text-xs text-status-danger">{t('baselinePage.tagAlreadyUsedByBaseline')}</p>
        )}
        {mainTags.includes(mainTag.trim()) && (
          <p className="mt-1 text-xs text-status-warning">{t('baselinePage.tagAlreadyExistsOnRepo')}</p>
        )}
        {tagConflictNodes.length > 0 && (
          <p className="mt-1 text-xs text-status-warning">
            {t('baselinePage.tagAlreadyExistsOn', { names: tagConflictNodes.map(r => r.node.name).join(', ') })}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-edge p-3">
        <label className="block text-xs text-ink-3 mb-1">{t('baselinePage.messageOptionalLabel')}</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('baselinePage.describeBaselinePlaceholder')}
          rows={3}
          className="w-full input-field text-xs resize-none"
        />
      </div>

      {isError && (
        <p className="text-xs text-status-danger">
          {errorMessage ?? t('baselinePage.creationError')}
        </p>
      )}

      {tagWarning && (
        <p className="text-xs text-status-warning leading-snug">{tagWarning}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCreate}
          disabled={!canCreate}
          className="btn-primary"
          title="Ctrl+Enter"
        >
          {isPending ? t('common.creating') : t('baselinePage.createBaseline')}
        </button>
      </div>
    </div>
  )
}

// ── BaselinePage ──────────────────────────────────────────────────────────────

/** GH40 — la vue de droite est le formulaire de création ; la liste des baselines vit dans le
 *  panneau Version (`BaselineListPanel`), alimentée par le même `useBaselines`. */
function BaselinePage() {
  const { t } = useTranslation()
  const { projectId } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const {
    workspaceDir, repoPath, flatNodes, componentNodes, baselines, structureError, structureConflicts,
  } = useBaselines(projectId)

  const { data: mainTags = [], dataUpdatedAt: mainTagsUpdatedAt } = useQuery({
    queryKey: ['sync:tags', repoPath],
    queryFn: () => api.sync.tags(repoPath),
    enabled: !!repoPath,
  })

  // T79: readiness of every repo in the workspace (root included) — a baseline can only be
  // created once every repo has no pending changes (T46: any branch is accepted).
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
  const blockingRepos = repoReadiness.filter(r => readinessIssueKey(r) !== null)

  function refreshReadiness() {
    // Prefix match (default react-query behavior): invalidates every repo's entry in one call.
    qc.invalidateQueries({ queryKey: ['sync:status'] })
    qc.invalidateQueries({ queryKey: ['baseline:integration-branch'] })
    qc.invalidateQueries({ queryKey: ['sync:tags'] })
  }

  const [mainTagOverride, setMainTagOverride] = useState<string | null>(null)
  const mainTag = mainTagOverride ?? nextTag(mainTags)
  const [message, setMessage] = useState('')
  const [createdTag, setCreatedTag] = useState<string | null>(null)
  // The form stays on screen after a creation (GH40, no popup to close): until the tag/baseline
  // lists refetch, nextTag() still suggests the tag just created — never let it be re-submitted.
  // The guard lifts once the root tag list has refetched (the tag is then caught by the regular
  // checks, or is free again if that baseline was deleted meanwhile).
  const [lastCreated, setLastCreated] = useState<{ tag: string; at: number } | null>(null)
  const staleCreatedTag = lastCreated && mainTagsUpdatedAt <= lastCreated.at ? lastCreated.tag : null

  const tagConflictNodes = repoReadiness.filter(r => (r.tags ?? []).includes(mainTag.trim()))
  const mainTagValid =
    mainTag.trim() !== '' &&
    mainTag.trim() !== staleCreatedTag &&
    !baselines.some(b => b.tag === mainTag.trim()) &&
    tagConflictNodes.length === 0

  const [tagWarning, setTagWarning] = useState<string | null>(null)

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
      setCreatedTag(record.tag)
      setLastCreated({ tag: record.tag, at: Date.now() })
      setTagWarning(
        record.components.length < componentNodes.length
          ? t('baselinePage.tagWarning', { count: componentNodes.length - record.components.length })
          : null,
      )
    },
  })

  const canCreate = mainTagValid && !createMutation.isPending && !!repoPath && !readinessLoading && blockingRepos.length === 0

  function handleCreate() {
    setCreatedTag(null)
    setTagWarning(null)
    createMutation.mutate()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{ onClick: () => navigate({ to: '/graph', search: { projectId, sha: undefined } }) }}
        title={
          <span className="flex items-center gap-2">
            <Tag size={14} className="text-prim" />
            {t('baselinePage.newBaseline')}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!repoPath ? (
          <p className="text-sm text-ink-3">{t('common.loading')}</p>
        ) : (
          <CreateBaselineForm
            repoReadiness={repoReadiness}
            structureError={structureError}
            structureConflicts={structureConflicts}
            readinessLoading={readinessLoading}
            blockingRepos={blockingRepos}
            refreshReadiness={refreshReadiness}
            mainTag={mainTag}
            setMainTagOverride={v => { setMainTagOverride(v); setCreatedTag(null) }}
            message={message}
            setMessage={v => { setMessage(v); setCreatedTag(null) }}
            baselines={baselines}
            mainTags={mainTags}
            tagConflictNodes={tagConflictNodes}
            canCreate={canCreate}
            createdTag={createdTag}
            tagWarning={tagWarning}
            isPending={createMutation.isPending}
            isError={createMutation.isError}
            errorMessage={createMutation.error instanceof Error ? createMutation.error.message : null}
            onCreate={handleCreate}
          />
        )}
      </div>
    </div>
  )
}
