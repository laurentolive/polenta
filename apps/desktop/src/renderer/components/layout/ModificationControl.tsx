import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { GitMerge, X } from 'lucide-react'
import { api } from '../../api'
import { useModificationMode } from '../../hooks/useModificationMode'
import { useVersioning } from '../../contexts/VersioningContext'
import type { PinPropagationOutcome } from '../../lib/workspaceActions'
import {
  publishWorkspace, PublishBlockedError, PublishConflictError, PublishNetworkError, PublishRepoError,
  type EphemeralBranch, type PublishedRepo,
} from '../../lib/publishWorkspace'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'

/** Popover anchored under its trigger (T92 — replaces the old full-screen centered `Overlay`).
 *  Click-away capture (no dimming) + Escape to close, reusing the pattern already established by
 *  `FieldConfigModal` (SystemView.tsx) rather than inventing a new one. Positioned `absolute`
 *  relative to `ModificationControl`'s own `relative` root, so it stays anchored under the button
 *  regardless of which view's header it's rendered in. */
function PublishPopover({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 top-full mt-2 z-50 bg-surface border border-edge rounded-lg shadow-xl p-6 w-96"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  )
}

interface Props {
  currentProjectId: string | null
}

function repoName(repo: { name: string; label?: string }): string {
  return repo.label || repo.name
}

export function ModificationControl({ currentProjectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    repoPath, branch, integrationBranch, mode, pendingChangesCount, refetch, workspaceDir, flatNodes, tree,
    pendingRepos, totalPendingCount,
  } = useModificationMode(currentProjectId)
  // GH38: identity of the set of repos the popup was opened for — any repo gaining or losing
  // pending changes while the title is being typed makes the popup stale, like a branch change.
  const pendingSignature = pendingRepos.map(r => `${r.repoPath}:${r.count}`).join('|')
  // VersioningContext tracks the root repo independently (its own 3s poll) — nudge it to
  // refresh immediately after a checkout so the header's readonly indicator doesn't lag by up
  // to 3s, same pattern as VersionRepoFolder's checkout mutations.
  const { refetch: refetchVersioning } = useVersioning()

  const [showPublishPopup, setShowPublishPopup] = useState(false)
  // T87: the popup can sit open while `branch` changes underneath it (someone else checks out a
  // different branch on the same repo from the Version panel while the user is mid-title-entry).
  // Captured when the popup opens, checked again at submit time — if either no longer matches,
  // refuse the stale submission instead of silently publishing against a branch the user never
  // saw when they typed the title.
  const [popupOpenedFor, setPopupOpenedFor] = useState<{ repoPath: string; branch: string; pending: string } | null>(null)
  const [title, setTitle] = useState('')
  const [publishError, setPublishError] = useState<
    // GH38: `repoPath`/`integrationBranch` are those of the repo that failed — not necessarily the
    // repo concerné — and `published` the repos already published before it in the same run.
    | { kind: 'conflict'; message: string; files: string[]; workBranch: string; repoPath: string; integrationBranch: string; published: string[] }
    | { kind: 'network'; message: string }
    | { kind: 'blocked'; message: string; repos: string[] }
    | { kind: 'generic'; message: string; published: string[] }
    | null
  >(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pinWarning, setPinWarning] = useState<PinPropagationOutcome | null>(null)
  // T87: an ephemeral `dev-<slug>` branch created by a previous "Publier" attempt that conflicted
  // and was therefore never cleaned up — the user is left checked out on it. Tracked (scoped to
  // the repo it was created for) so that retrying "Publier" from that same branch still finishes
  // the nominal flow (checkout back to the integration branch + delete it) instead of silently
  // treating it as a user-owned advanced branch that's never cleaned up, once `branch` no longer
  // equals `integrationBranch`. Deliberately NOT reset by the mode/branch-change effect below —
  // the whole point is to survive exactly the branch change a conflict causes.
  // GH38: still a single entry — a multi-repo publish stops at the first failing repo, so at most
  // one repo can be left on its ephemeral branch.
  const [ephemeralBranch, setEphemeralBranch] = useState<EphemeralBranch | null>(null)

  // The mode (or the resolved repo/branch itself) can change out from under an open dialog for
  // reasons outside this component's control (someone else checks out a different branch on the
  // same repo from the Version panel, a merge completes elsewhere, …). Close any transient dialog
  // rather than letting it act on a branch it was no longer opened for.
  useEffect(() => {
    setShowPublishPopup(false)
    setPopupOpenedFor(null)
    setPushError(null)
    // T82: a pin-propagation warning is scoped to the repo/publish that produced it — clear it
    // when switching mode (which also happens when the resolved repo itself changes) so a stale
    // warning about a different repo doesn't linger indefinitely.
    setPinWarning(null)
    // `publishError` is deliberately NOT reset here: it's a record of what the last publish
    // attempt did, not a live view of current branch state, and `onError`'s conflict path calls
    // `refetch()` to make `branch` catch up for a correct retry — that branch change must not
    // wipe the very error dialog it was just shown for. It's cleared explicitly by the user
    // (Fermer / Résolution manuelle) or by the next successful publish.
  }, [mode, repoPath, branch])

  function invalidateAll() {
    refetch()
    refetchVersioning()
  }

  // Push is best-effort and doesn't gate "Publier" completing — the merges are already durable
  // locally at this point. Deliberately not awaited: a slow/flaky remote shouldn't keep the dialog
  // on "Publication…" once the local work is safely merged. GH38: one push per published repo,
  // failures aggregated and prefixed with the repo's name.
  function pushPublished(published: PublishedRepo[]) {
    Promise.allSettled(published.map(r => api.sync.pushBranch(r.repoPath, r.integrationBranch)))
      .then(results => {
        const errors = results.flatMap((res, i) => res.status === 'rejected'
          ? [`${repoName(published[i])} : ${res.reason instanceof Error ? res.reason.message : t('layout.modificationControl.pushError')}`]
          : [])
        setPushError(errors.length > 0 ? errors.join(' — ') : null)
      })
  }

  // GH38: "Publier" publishes every repo of the workspace that has something to publish, children
  // before parents, each through the unchanged T87/T154 single-repo flow (see `publishWorkspace`).
  // `mode` (repo concerné) still drives the button's visibility; a candidate repo on a blocked
  // branch is refused by `publishWorkspace` before anything is touched.
  const publishMutation = useMutation({
    mutationFn: () => {
      // Plain repo, or workspace structure still loading: `tree` is empty — fall back to the repo
      // concerné alone, i.e. exactly the pre-GH38 behavior.
      const roots = tree.length > 0
        ? tree
        : [{ name: 'root', repoPath, url: '', pin: '', isInterface: false, children: [] }]
      return publishWorkspace({
        workspaceDir,
        flatNodes,
        roots,
        title,
        ephemeral: ephemeralBranch,
        onEphemeralChange: setEphemeralBranch,
      })
    },
    onSuccess: (result) => {
      setShowPublishPopup(false)
      setPopupOpenedFor(null)
      setTitle('')
      setPublishError(null)
      // T82: set before invalidateAll() below, which can flip `mode`/`branch` and would otherwise
      // race the reset effect that clears pinWarning.
      setPinWarning(result.pinOutcome)
      invalidateAll()

      pushPublished(result.published)
    },
    onError: (err: unknown) => {
      setShowPublishPopup(false)
      setPopupOpenedFor(null)
      if (err instanceof PublishBlockedError) {
        // GH38: refused before anything was touched.
        setPublishError({
          kind: 'blocked',
          message: t('layout.modificationControl.blockedRepos'),
          repos: err.repos.map(r => `${repoName(r.repo)} : ${r.branch || 'HEAD'} ≠ ${r.integrationBranch}`),
        })
        return
      }
      if (err instanceof PublishNetworkError) {
        // T154: thrown before any branch/commit was created — nothing to refetch or clean up,
        // every repo is exactly as it was before the click.
        setPublishError({
          kind: 'network',
          message: t('layout.modificationControl.networkErrorRepo', { repo: repoName(err.repo) }),
        })
        return
      }
      // The failing repo may now be checked out on its ephemeral branch, and the repos published
      // before it have changed too — without this refetch an immediate retry (before the next 3s
      // poll) would not recognize `continuingEphemeral` from a stale `sync:status`.
      invalidateAll()
      if (err instanceof PublishRepoError) {
        // GH38: the repos published before the failing one are merged for good — push them too.
        pushPublished(err.published)
        const published = err.published.map(repoName)
        if (err.reason instanceof PublishConflictError) {
          setPublishError({
            kind: 'conflict',
            message: t('layout.modificationControl.conflictOnRepo', { repo: repoName(err.repo) }),
            files: err.reason.conflicts,
            workBranch: err.reason.workBranch,
            repoPath: err.repo.repoPath,
            integrationBranch: err.integrationBranch,
            published,
          })
          return
        }
        setPublishError({
          kind: 'generic',
          message: t('layout.modificationControl.failedOnRepo', { repo: repoName(err.repo), error: err.message }),
          published,
        })
        return
      }
      setPublishError({
        kind: 'generic',
        message: err instanceof Error ? err.message : t('layout.modificationControl.genericError'),
        published: [],
      })
    },
  })

  if (!repoPath || mode === 'other') return null

  const isStalePopup =
    !!popupOpenedFor && (
      popupOpenedFor.repoPath !== repoPath || popupOpenedFor.branch !== branch || popupOpenedFor.pending !== pendingSignature
    )

  function submitPublish() {
    if (!title.trim() || publishMutation.isPending || isStalePopup) return
    publishMutation.mutate()
  }

  const showNotifications = !!pushError || (!!pinWarning && (pinWarning.conflicted.length > 0 || pinWarning.failed.length > 0))

  return (
    <div className="relative flex items-center gap-2 shrink-0">
      {mode === 'blocked' && (
        <span className="text-xs text-ink-3 bg-surface border border-edge rounded px-2 py-1 max-w-xs text-right">
          <Trans
            i18nKey="layout.modificationControl.blockedBranch"
            values={{ branch, integrationBranch }}
            components={{ mono: <span className="font-mono" /> }}
          />
        </span>
      )}

      {mode === 'active' && (
        <button
          type="button"
          onClick={() => { setShowPublishPopup(true); setPopupOpenedFor({ repoPath, branch, pending: pendingSignature }) }}
          disabled={totalPendingCount === 0 && pendingChangesCount === 0}
          className="btn-primary-sm flex items-center gap-1.5 shadow"
        >
          <GitMerge size={12} />
          {t('layout.modificationControl.publish')}
        </button>
      )}

      {showNotifications && (
        <div className="absolute right-0 top-full mt-1.5 z-40 flex flex-col items-end gap-1.5">
          {pushError && (
            <div className="bg-surface border border-edge rounded px-2 py-1.5 max-w-xs shadow flex items-start gap-2">
              <p className="text-xs text-status-warning leading-snug">
                {t('layout.modificationControl.pushFailed', { error: pushError })}
              </p>
              <button type="button" onClick={() => setPushError(null)} className="text-ink-3 hover:text-ink shrink-0">
                <X size={12} />
              </button>
            </div>
          )}

          {pinWarning && (pinWarning.conflicted.length > 0 || pinWarning.failed.length > 0) && (
            <div className="bg-surface border border-edge rounded px-2 py-1.5 max-w-xs shadow">
              <PinPropagationWarning outcome={pinWarning} onDismiss={() => setPinWarning(null)} />
            </div>
          )}
        </div>
      )}

      {mode === 'active' && showPublishPopup && (
        <PublishPopover onClose={() => setShowPublishPopup(false)}>
          <h2 className="font-semibold mb-4 text-sm text-ink">{t('layout.modificationControl.publish')}</h2>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitPublish()
            }}
            placeholder={t('layout.modificationControl.titlePlaceholder')}
            className="input-field w-full mb-4"
            autoFocus
          />
          {pendingRepos.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-ink-2 mb-1">{t('layout.modificationControl.reposToPublish')}</p>
              <ul className="text-xs text-ink-2 list-disc list-inside">
                {pendingRepos.map(r => (
                  <li key={r.repoPath}>
                    {repoName(r)}{' '}
                    <span className="text-ink-3">{t('layout.modificationControl.repoFiles', { count: r.count })}</span>
                  </li>
                ))}
              </ul>
              {flatNodes.length > 1 && (
                <p className="text-xs text-ink-3 mt-1">{t('layout.modificationControl.parentsNote')}</p>
              )}
            </div>
          )}
          {isStalePopup && (
            <p className="text-xs text-status-warning mb-3">
              {t('layout.modificationControl.staleState')}
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowPublishPopup(false)}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={submitPublish}
              disabled={!title.trim() || publishMutation.isPending || isStalePopup}
              className="btn-primary"
            >
              {publishMutation.isPending ? t('layout.modificationControl.publishing') : t('layout.modificationControl.publish')}
            </button>
          </div>
        </PublishPopover>
      )}

      {publishError && (
        <PublishPopover onClose={() => setPublishError(null)}>
          <h2 className="font-semibold text-sm text-ink mb-2">{t('layout.modificationControl.publishImpossible')}</h2>
          <p className="text-xs text-ink-2 mb-2">
            {publishError.message}
          </p>
          {publishError.kind === 'conflict' && publishError.files.length > 0 && (
            <ul className="text-xs font-mono text-ink-2 mb-2 list-disc list-inside">
              {publishError.files.map(f => <li key={f}>{f}</li>)}
            </ul>
          )}
          {publishError.kind === 'blocked' && (
            <ul className="text-xs font-mono text-ink-2 mb-2 list-disc list-inside">
              {publishError.repos.map(r => <li key={r}>{r}</li>)}
            </ul>
          )}
          {(publishError.kind === 'conflict' || publishError.kind === 'generic') && publishError.published.length > 0 && (
            <p className="text-xs text-ink-3 mb-2">
              {t('layout.modificationControl.alreadyPublished', { repos: publishError.published.join(', ') })}
            </p>
          )}
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" onClick={() => setPublishError(null)} className="btn-secondary-sm">
              {t('common.close')}
            </button>
            {publishError.kind === 'conflict' && (
              <button
                type="button"
                onClick={() => {
                  // GH38: the diff of the repo that conflicted, not of the repo concerné.
                  const { workBranch, repoPath: failedRepoPath, integrationBranch: failedIntegrationBranch } = publishError
                  setPublishError(null)
                  navigate({
                    to: '/version-diff',
                    search: { projectId: currentProjectId ?? '', repoPath: failedRepoPath, ref1: workBranch, sha1: undefined, ref2: failedIntegrationBranch, sha2: undefined },
                  })
                }}
                className="btn-primary-sm flex items-center gap-1"
              >
                <X size={11} />
                {t('layout.modificationControl.manualResolution')}
              </button>
            )}
          </div>
        </PublishPopover>
      )}
    </div>
  )
}
