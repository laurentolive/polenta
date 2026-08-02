import { useEffect, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { GitMerge, X } from 'lucide-react'
import { api } from '../../api'
import { useModificationMode } from '../../hooks/useModificationMode'
import { useVersioning } from '../../contexts/VersioningContext'
import { propagatePinToDependents, type PinPropagationOutcome } from '../../lib/workspaceActions'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'

const DIACRITICS = /[̀-ͯ]/g

/** `dev-<slug>` — lowercase, accents stripped, non-alphanumeric runs collapsed to `-`, capped. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

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

/** Thrown by `publishMutation`'s `mutationFn` on a merge conflict, caught by `onError` — keeps
 *  the mutation's success type down to just `{ sha }` instead of a result union the conflict
 *  case would otherwise have to be re-shaped into for display. */
class PublishConflictError extends Error {
  constructor(public readonly conflicts: string[], public readonly workBranch: string) {
    super('merge-conflict')
  }
}

/** T154: thrown when the early `fetch` (before any branch/commit is touched) fails — kept
 *  distinct from `PublishConflictError` so `onError` can show a dedicated "no network" message
 *  instead of the generic one, and reassure the user nothing was created/committed. */
class PublishNetworkError extends Error {
  constructor(public readonly detail: string) {
    super('network-unavailable')
  }
}

interface Props {
  currentProjectId: string | null
}

export function ModificationControl({ currentProjectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { repoPath, branch, integrationBranch, mode, pendingChangesCount, refetch, workspaceDir, flatNodes } =
    useModificationMode(currentProjectId)
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
  const [popupOpenedFor, setPopupOpenedFor] = useState<{ repoPath: string; branch: string } | null>(null)
  const [title, setTitle] = useState('')
  const [publishError, setPublishError] = useState<
    | { kind: 'conflict'; message: string; files: string[]; workBranch: string }
    | { kind: 'network'; message: string }
    | { kind: 'generic'; message: string }
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
  const [ephemeralBranch, setEphemeralBranch] = useState<{ repoPath: string; branch: string } | null>(null)

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

  // T87: "Publier" resolves its own strategy from `branch` vs `integrationBranch` (and the
  // leftover `ephemeralBranch` from a previous conflicted attempt, if any) at the moment it runs —
  // on the configured integration branch it creates an ephemeral `dev-<slug>` first (deleted again
  // once merged); from any other branch (dev-* or a freely-named one — advanced, git-savvy usage)
  // it commits directly on that branch and never deletes or checks it out away from — the user
  // created it, they stay responsible for it. `mode === 'blocked'` (another `int-*` branch than
  // the configured one) never reaches this mutation — the button isn't shown.
  const publishMutation = useMutation({
    mutationFn: async (): Promise<{ sha: string }> => {
      const continuingEphemeral =
        ephemeralBranch?.repoPath === repoPath && ephemeralBranch.branch === branch
      const isNominal = branch === integrationBranch || continuingEphemeral
      let workBranch = branch

      // T154: check the network first, before anything else is touched — a failure here (proxy,
      // offline, auth) must leave the repo exactly as it was, so the user just retries once
      // connected instead of finding a half-finished publish (ephemeral branch, orphan commit).
      // Safe to run while still checked out on `integrationBranch` (the nominal case): fetch only
      // ever writes remote-tracking refs, never local branches.
      const node = flatNodes.find(n => n.repoPath === repoPath)
      try {
        await api.sync.fetch(repoPath, node?.url ?? '')
      } catch (err) {
        throw new PublishNetworkError(err instanceof Error ? err.message : String(err))
      }

      if (branch === integrationBranch) {
        const branches = await api.sync.branches(repoPath)
        const existing = new Set(branches.map(b => b.name))
        const slug = slugify(title)
        const base = slug ? `dev-${slug}` : 'dev-modification'
        let name = base
        let n = 2
        while (existing.has(name)) {
          name = `${base}-${n}`
          n += 1
        }
        await api.sync.createBranch(repoPath, name)
        workBranch = name
        setEphemeralBranch({ repoPath, branch: name })
      }

      // T154: `workBranch` is never `integrationBranch` at this point — either just created above
      // (nominal case) or already a dev-*/free branch the user was on (advanced case) — so moving
      // the integration branch's ref here can't desync it from a checkout. Fast-forwards it to the
      // fetch just done if it's a plain fast-forward; a genuine divergence (pre-existing, rare —
      // see SPEC-FORKS-BRANCHES-BASELINES.md §2.1) is left untouched and falls through to the
      // ordinary mergeInto/push behavior below, unchanged from before this ticket.
      await api.sync.fastForwardBranch(repoPath, integrationBranch)

      await api.sync.stageAll(repoPath)
      await api.sync.commit(repoPath, title.trim() || `Modification sur ${branch}`)
      const merge = await api.sync.mergeInto(repoPath, workBranch, integrationBranch)
      if (!merge.success) throw new PublishConflictError(merge.conflicts, workBranch)

      if (isNominal) {
        await api.sync.checkoutBranch(repoPath, integrationBranch)
        await api.sync.deleteBranch(repoPath, workBranch).catch(() => {})
        setEphemeralBranch(null)
      }

      return { sha: merge.sha }
    },
    onSuccess: async (result) => {
      setShowPublishPopup(false)
      setPopupOpenedFor(null)
      setTitle('')
      setPublishError(null)
      // T82: propose the merge SHA as pin wherever this repo is declared as a dependency.
      // Resolved — and the resulting warning set — before invalidateAll() below, which can flip
      // `mode`/`branch` and would otherwise race the reset effect that clears pinWarning.
      const node = flatNodes.find(n => n.repoPath === repoPath)
      if (node) {
        const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, result.sha)
        setPinWarning(outcome)
      }
      invalidateAll()

      // Push is best-effort and doesn't gate "Publier" completing — the merge is already durable
      // locally at this point. Deliberately not awaited: a slow/flaky remote shouldn't keep the
      // dialog on "Publication…" once the local work is safely merged.
      api.sync.pushBranch(repoPath, integrationBranch)
        .then(() => setPushError(null))
        .catch((err: unknown) => setPushError(err instanceof Error ? err.message : t('layout.modificationControl.pushError')))
    },
    onError: (err: unknown) => {
      setShowPublishPopup(false)
      setPopupOpenedFor(null)
      if (err instanceof PublishConflictError) {
        setPublishError({
          kind: 'conflict',
          message: t('layout.modificationControl.conflictMessage'),
          files: err.conflicts,
          workBranch: err.workBranch,
        })
        // The repo is now actually checked out on `err.workBranch` (the ephemeral branch created
        // just before the conflicting merge), but `branch` here is still the pre-mutation value —
        // `sync:status` isn't polled/invalidated until this refetch. Without it, an immediate retry
        // (before the next 3s poll) would still see `branch === integrationBranch` and try to
        // create a second ephemeral branch instead of recognizing `continuingEphemeral`.
        refetch()
        return
      }
      if (err instanceof PublishNetworkError) {
        // T154: thrown before any branch/commit was created — nothing to refetch or clean up,
        // the repo is exactly as it was before the click.
        setPublishError({ kind: 'network', message: t('layout.modificationControl.networkError') })
        return
      }
      setPublishError({ kind: 'generic', message: err instanceof Error ? err.message : t('layout.modificationControl.genericError') })
    },
  })

  if (!repoPath || mode === 'other') return null

  const isStalePopup =
    !!popupOpenedFor && (popupOpenedFor.repoPath !== repoPath || popupOpenedFor.branch !== branch)

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
          onClick={() => { setShowPublishPopup(true); setPopupOpenedFor({ repoPath, branch }) }}
          disabled={pendingChangesCount === 0}
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
          <p className={`text-xs text-ink-2 ${publishError.kind === 'conflict' && publishError.files.length > 0 ? 'mb-2' : 'mb-4'}`}>
            {publishError.message}
          </p>
          {publishError.kind === 'conflict' && publishError.files.length > 0 && (
            <ul className="text-xs font-mono text-ink-2 mb-4 list-disc list-inside">
              {publishError.files.map(f => <li key={f}>{f}</li>)}
            </ul>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setPublishError(null)} className="btn-secondary-sm">
              {t('common.close')}
            </button>
            {publishError.kind === 'conflict' && (
              <button
                type="button"
                onClick={() => {
                  const workBranch = publishError.workBranch
                  setPublishError(null)
                  navigate({
                    to: '/version-diff',
                    search: { projectId: currentProjectId ?? '', repoPath, ref1: workBranch, sha1: undefined, ref2: integrationBranch, sha2: undefined },
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
