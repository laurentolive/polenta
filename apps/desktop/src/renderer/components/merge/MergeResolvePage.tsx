import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, GitMerge } from 'lucide-react'
import type { MergeFinalizeResult, MergeSessionInfo } from '@polenta/types'
import { shortRef } from '@polenta/merge-core'
import { api } from '../../api'
import { useSetTabTitle, useTabs } from '../../contexts/TabsContext'
import { useModificationMode } from '../../hooks/useModificationMode'
import {
  PublishConflictError, PublishRepoError, resumePublishAfterResolution, type ResumePublishResult,
} from '../../lib/publishWorkspace'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'
import { FileResolver } from './FileResolver'
import { primeMergeSession, useMergeSession } from './useMergeSession'

interface Props {
  id: string
  projectId: string
  /** GH233 — fichier ouvert (URL), choisi aussi depuis le panneau latéral « Fichiers en conflit ». */
  selected: string | null
  onSelect: (path: string) => void
}

/** Outcome shown once the merge is finalized (the tab stays open so it can be read). */
interface Done {
  sha: string
  session: MergeSessionInfo
  /** Publier: the rest of the publication is running. */
  resuming?: boolean
  publish?: ResumePublishResult & { pushErrors: string[] }
}

const repoLabel = (repoPath: string) => repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? repoPath

/**
 * GH37 — éditeur de résolution des conflits d'un merge (specs/GH37.md, design §3).
 * Liste des fichiers en conflit dans le panneau latéral (GH233), résolution du fichier sélectionné, finalisation
 * (commit de merge en main) puis suite de l'opération d'origine (Publier : fin de la publication).
 */
export function MergeResolvePage({ id, projectId, selected, onSelect: setSelected }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { activeTabId, closeTab } = useTabs()
  const { session: sessionQuery, saveFile, setSession } = useMergeSession(id)
  const session = sessionQuery.data ?? null
  const { workspaceDir, flatNodes, tree } = useModificationMode(projectId || null)

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Extract<MergeFinalizeResult, { ok: false }> | { reason: 'error'; message: string } | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [done, setDone] = useState<Done | null>(null)

  useSetTabTitle(session ? t('mergeResolve.tabTitle', { repo: repoLabel(session.repoPath) }) : t('mergeResolve.title'))

  useEffect(() => {
    if (session && (selected === null || !session.files.some(f => f.path === selected))) {
      const first = (session.files.find(f => f.state === 'todo') ?? session.files[0])?.path
      if (first) setSelected(first)
    }
    // setSelected changes with the URL; the selection only depends on the session and the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selected])

  if (done) {
    return (
      <DonePanel done={done} onClose={() => closeTab(activeTabId)} onResolveNext={openNext}
        onRetry={() => resume(done.session, done.sha)} />
    )
  }
  if (sessionQuery.isLoading) return <p className="p-6 text-sm text-ink-3 italic">{t('common.loading')}</p>
  if (!session) {
    return <p className="p-6 text-sm text-ink-3">{t('mergeResolve.noSession')}</p>
  }

  /** « Garder les deux » recomputed the session: file contents changed, cached details are stale. */
  function onSessionChanged(s: MergeSessionInfo) {
    qc.removeQueries({ queryKey: ['merge-resolution', s.id, 'file'] })
    setSession(s)
  }

  /**
   * A branch moved since this resolution was opened: it can't be finalized any more. Start over
   * from the current state of the same merge (the stale draft is replaced, GH37 §10). For Publier,
   * the integration branch is first brought up to date with the remote (T154), as "Publier" does.
   */
  async function restart() {
    if (!session) return
    setBusy(true)
    setFailure(null)
    try {
      const { origin } = session
      if (origin.kind === 'publish') {
        await api.sync.fetch(session.repoPath, '').catch(() => {})
        await api.sync.fastForwardBranch(session.repoPath, origin.integrationBranch).catch(() => {})
      }
      const next = await api.mergeResolution.open(session.repoPath, session.leftRef, session.rightRef, origin)
      primeMergeSession(qc, next)
      void qc.invalidateQueries({ queryKey: ['merge-resolution'] })
      void navigate({ to: '/merge-resolve', search: { id: next.id, projectId } })
    } catch (err) {
      setFailure({ reason: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const mergedCount = session.files.filter(f => f.state === 'merged').length
  const allMerged = mergedCount === session.files.length

  function selectNextTodo(s: MergeSessionInfo, after: string) {
    const i = s.files.findIndex(f => f.path === after)
    const next = [...s.files.slice(i + 1), ...s.files.slice(0, i)].find(f => f.state === 'todo')
    if (next) setSelected(next.path)
  }

  async function finalize() {
    if (!session) return
    setBusy(true)
    setFailure(null)
    try {
      const res = await api.mergeResolution.finalize(session.id)
      if (!res.ok) {
        setFailure(res)
        return
      }
      // The merge commit exists from here on: whatever happens next is shown on the done panel,
      // which can retry the rest of the publication (the draft is gone, "Finaliser" can't).
      setDone({ sha: res.sha, session: res.session, resuming: res.session.origin.kind === 'publish' })
      await resume(res.session, res.sha)
    } catch (err) {
      setFailure({ reason: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  async function abandon() {
    if (!session) return
    await api.mergeResolution.abandon(session.id)
    // GH234 — forgotten, not cached as `null`: reopening the same merge gets the same id back.
    qc.removeQueries({ queryKey: ['merge-resolution', session.id] })
    void qc.invalidateQueries({ queryKey: ['merge-resolution', 'list'] })
    closeTab(activeTabId)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barre de la résolution */}
      <div className="px-4 py-2.5 border-b border-edge shrink-0 flex items-center gap-3">
        <GitMerge size={16} className="text-ink-3 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-ink truncate">{t('mergeResolve.tabTitle', { repo: repoLabel(session.repoPath) })}</h1>
          <p className="text-xs text-ink-3 truncate">
            {t('mergeResolve.subtitle', { left: shortRef(session.leftRef), right: shortRef(session.rightRef) })}
          </p>
        </div>
        <span className="text-xs text-ink-2 shrink-0">{t('mergeResolve.progress', { merged: mergedCount, total: session.files.length })}</span>
        <div className="relative">
          <button type="button" className="btn-secondary-sm" disabled={busy}
            onClick={() => (mergedCount > 0 ? setConfirmAbandon(true) : void abandon())}>
            {t('mergeResolve.abandon')}
          </button>
          {confirmAbandon && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-surface border border-edge rounded-lg shadow-xl p-4">
              <p className="text-xs text-ink-2 mb-3">{t('mergeResolve.abandonConfirm', { count: mergedCount })}</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary-sm" onClick={() => setConfirmAbandon(false)}>{t('common.cancel')}</button>
                <button type="button" className="btn-danger-sm" onClick={() => void abandon()}>{t('mergeResolve.abandon')}</button>
              </div>
            </div>
          )}
        </div>
        <button type="button" className="btn-primary-sm" disabled={!allMerged || busy || !!session.stale} onClick={() => void finalize()}>
          {busy ? t('mergeResolve.finalizing') : t('mergeResolve.finalize')}
        </button>
      </div>
      {(session.stale || failure?.reason === 'stale') && (
        <div className="px-4 py-2 border-b border-edge bg-status-warning-bg text-xs text-status-warning shrink-0 flex items-center gap-3">
          <span className="flex-1">{t('mergeResolve.staleBanner')}</span>
          <button type="button" className="btn-primary-sm" disabled={busy} onClick={() => void restart()}>
            {t('mergeResolve.restart')}
          </button>
        </div>
      )}
      {session.replacedStaleDraft && !session.stale && (
        <div className="px-4 py-2 border-b border-edge bg-status-info-bg text-xs text-status-info shrink-0">
          {t('mergeResolve.replacedStaleDraft')}
        </div>
      )}
      {failure && failure.reason !== 'stale' && (
        <div className="px-4 py-2 border-b border-edge bg-status-danger-bg text-xs text-status-danger shrink-0">
          {failure.reason === 'error' ? failure.message : t(`mergeResolve.failure.${failure.reason}`)}
          {'paths' in failure && failure.paths && failure.paths.length > 0 && (
            <span className="font-mono"> — {failure.paths.join(', ')}</span>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0 min-h-0">
          {selected ? (
            <FileResolver session={session} path={selected} saveFile={saveFile} onSessionChanged={onSessionChanged}
              onNextFile={() => selectNextTodo(qc.getQueryData<MergeSessionInfo>(['merge-resolution', session.id]) ?? session, selected)}
              onMerged={() => {
                const s = qc.getQueryData<MergeSessionInfo>(['merge-resolution', session.id]) ?? session
                selectNextTodo(s, selected)
              }} />
          ) : (
            <p className="p-6 text-sm text-ink-3 italic">
              {session.files.length === 0 ? t('mergeResolve.noConflicts') : t('mergeResolve.selectFile')}
            </p>
          )}
        </main>
      </div>
    </div>
  )

  /**
   * After the merge commit: the rest of the original operation. Publier — finish this repo's
   * publication and publish the remaining repos (`resumePublishAfterResolution`), then the same
   * best-effort push as "Publier". Never throws: a failure is shown with a retry.
   */
  async function resume(s: MergeSessionInfo, sha: string) {
    const origin = s.origin
    if (origin.kind === 'publish') {
      setDone({ sha, session: s, resuming: true })
      let publish: Done['publish']
      try {
        const roots = tree.length > 0
          ? tree
          : [{ name: 'root', repoPath: s.repoPath, url: '', pin: '', isInterface: false, children: [] }]
        const result = await resumePublishAfterResolution({
          workspaceDir, flatNodes, roots,
          repoPath: s.repoPath,
          workBranch: origin.workBranch,
          ephemeral: origin.ephemeral,
          integrationBranch: origin.integrationBranch,
          title: origin.title,
          sha,
        })
        const pushes = await Promise.allSettled(result.published.map(r => api.sync.pushBranch(r.repoPath, r.pushBranch)))
        const pushErrors = pushes.flatMap((p, i) => p.status === 'rejected'
          ? [`${result.published[i].label || result.published[i].name} : ${p.reason instanceof Error ? p.reason.message : String(p.reason)}`]
          : [])
        publish = { ...result, pushErrors }
      } catch (error) {
        publish = { published: [], pinOutcome: { updated: [], conflicted: [], failed: [] }, error, pushErrors: [] }
      }
      setDone({ sha, session: s, publish })
    }
    void qc.invalidateQueries()
  }

  /** A later repo of the resumed publication conflicted: open its resolution in this tab. */
  async function openNext(err: PublishRepoError & { reason: PublishConflictError }, title: string) {
    const next = await api.mergeResolution.open(err.repo.repoPath, err.reason.workBranch, err.integrationBranch, {
      kind: 'publish', workBranch: err.reason.workBranch, integrationBranch: err.integrationBranch, title, ephemeral: err.reason.ephemeral,
    })
    primeMergeSession(qc, next)
    setDone(null)
    void navigate({ to: '/merge-resolve', search: { id: next.id, projectId } })
  }
}

function DonePanel({ done, onClose, onResolveNext, onRetry }: {
  done: Done
  onClose: () => void
  onResolveNext: (err: PublishRepoError & { reason: PublishConflictError }, title: string) => Promise<void>
  onRetry: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { publish } = done
  const err = publish?.error
  const conflict = err instanceof PublishRepoError && err.reason instanceof PublishConflictError
    ? (err as PublishRepoError & { reason: PublishConflictError })
    : null
  const [pending, setPending] = useState(false)
  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-base font-semibold text-ink mb-2 flex items-center gap-2">
        <CheckCircle2 size={18} className="text-status-success" />
        {t('mergeResolve.doneTitle')}
      </h1>
      <p className="text-sm text-ink-2 mb-4">{t('mergeResolve.doneSha', { sha: done.sha.slice(0, 7) })}</p>
      {done.resuming && <p className="text-sm text-ink-3 italic mb-4">{t('mergeResolve.resuming')}</p>}
      {publish && !done.resuming && (
        <div className="space-y-2 mb-4 text-sm">
          <p className="text-ink-2">
            {t('mergeResolve.donePublished', { repos: publish.published.map(r => r.label || r.name).join(', ') })}
          </p>
          {err !== undefined && (
            <p className="text-status-danger">
              {conflict
                ? t('mergeResolve.nextConflict', { repo: conflict.repo.label || conflict.repo.name })
                : t('mergeResolve.resumeFailed', { error: err instanceof Error ? err.message : String(err) })}
            </p>
          )}
          {publish.pushErrors.length > 0 && (
            <p className="text-status-warning">{t('layout.modificationControl.pushFailed', { error: publish.pushErrors.join(' — ') })}</p>
          )}
          <PinPropagationWarning outcome={publish.pinOutcome} onDismiss={() => {}} />
        </div>
      )}
      <div className="flex gap-2">
        {conflict && !done.resuming && (
          <button type="button" className="btn-primary-sm" disabled={pending}
            onClick={() => { setPending(true); void onResolveNext(conflict, titleOf(done)).finally(() => setPending(false)) }}>
            {t('layout.modificationControl.resolveConflicts')}
          </button>
        )}
        {err !== undefined && !conflict && !done.resuming && (
          <button type="button" className="btn-primary-sm" onClick={() => void onRetry()}>
            {t('mergeResolve.retryResume')}
          </button>
        )}
        <button type="button" className="btn-secondary-sm" disabled={done.resuming} onClick={onClose}>{t('mergeResolve.closeTab')}</button>
      </div>
    </div>
  )
}

/** The publication title travels with the session origin — reused for the next repo. */
function titleOf(done: Done): string {
  return done.session.origin.kind === 'publish' ? done.session.origin.title : ''
}
