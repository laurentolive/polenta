import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { ArrowDownUp, ChevronDown, ChevronRight, FolderGit2, GitFork, History, RefreshCw, Undo2 } from 'lucide-react'
import { api } from '../../../api'
import { useSelectedRepo } from '../../../contexts/SelectedRepoContext'
import { useBranchCheckout } from '../../../hooks/useBranchCheckout'
import { propagatePinToDependents, type PinPropagationOutcome } from '../../../lib/workspaceActions'
import { BranchCombobox } from './BranchCombobox'
import { PinPropagationWarning } from './PinPropagationWarning'
import { useModalHotkeys } from '../../../hooks/useModalHotkeys'
import { useRepoIntegrationSync, useResyncIntegration } from '../../../hooks/useIntegrationSync'
import type { WorkspaceTreeNode } from '@polenta/types'

interface Props {
  node: WorkspaceTreeNode
  depth: number
  projectId: string
  /** Workspace root directory — needed to propagate a pin update to dependent repos (T82). */
  workspaceDir: string
  /** All repos in the current workspace — needed to find who declares this node as a dependency (T82). */
  flatNodes: WorkspaceTreeNode[]
}

/** One repo's git-status/checkout panel — root or a component/interface, all scoped to `node.repoPath`.
 *  Mirrors `RepoRow` in StructureTab.tsx (chevron, indent, own `open` state, recursion over `children`),
 *  but each row here owns its own git queries/mutations/modals instead of a shared schema. */
export function VersionRepoFolder({ node, depth, projectId, workspaceDir, flatNodes }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { selectedRepoPath, selectRepo } = useSelectedRepo()
  const { repoPath } = node
  const indent = depth * 16
  const isSelected = repoPath === selectedRepoPath

  const [open, setOpen] = useState(true)
  const [commitMessage, setCommitMessage] = useState('')
  const [showCommitModal, setShowCommitModal] = useState(false)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
  const [discardConfirmPath, setDiscardConfirmPath] = useState<string | null>(null)
  const [checkoutConfirm, setCheckoutConfirm] = useState<{ value: string; isCommit: boolean } | null>(null)
  const [commitPinWarning, setCommitPinWarning] = useState<PinPropagationOutcome | null>(null)
  // The branch combobox now sits in the always-visible header (T87), not gated by the folder's
  // own open/closed state — so branches/tags are fetched only while its dropdown is actually
  // open, same pattern as the Structure tab's RepoBranchSelector.
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)

  // Mounted unconditionally (not gated by `open`) so the closed-folder dirty badge stays
  // accurate without requiring the folder to be opened first.
  const { data: syncStatus } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: !!repoPath,
    refetchInterval: 3000,
  })

  const {
    currentBranch, allBranches, allTags,
    checkout, checkoutCommit, createBranch, deleteBranch, isPending: isBranchPending,
    isCheckoutError, checkoutError, pinWarning: checkoutPinWarning, dismissPinWarning,
  } = useBranchCheckout(node, workspaceDir, flatNodes, branchDropdownOpen)

  const staged = syncStatus?.staged ?? []
  const unstaged = syncStatus?.unstaged ?? []
  const isDirty = staged.length + unstaged.length > 0
  const ahead = syncStatus?.ahead ?? 0

  // GH39: integration branch vs origin — badge + "Resynchroniser" while ahead/diverged.
  const { info: integrationInfo, lastError: syncError, alert: syncAlert } = useRepoIntegrationSync(repoPath)
  const { resync, pendingRepoPath: resyncPending, anyPending: anyResyncPending, setAside, reset: resetResync } = useResyncIntegration()
  const showIntegrationBadge = !!integrationInfo && integrationInfo.state !== 'up-to-date' && integrationInfo.state !== 'no-remote'

  const pushMutation = useMutation({
    mutationFn: () => api.sync.push(repoPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
    },
  })

  // T153: git pull, only ever invoked while the tree is clean — see `disabled` on the button
  // below (mirrors the `isDirty` guard already used for checkout in handleCheckout above).
  const pullMutation = useMutation({
    mutationFn: () => api.sync.pull(repoPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:graph', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
    },
  })

  const commitMutation = useMutation({
    mutationFn: () => {
      if (staged.length === 0) throw new Error(t('sidebar.version.nothingStagedToCommit'))
      return api.sync.commit(repoPath, commitMessage)
    },
    onSuccess: async ({ sha }) => {
      setShowCommitModal(false)
      setCommitMessage('')
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:graph', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
      // T82: this repo's HEAD just advanced — propose the new SHA as pin wherever this repo
      // is declared as a dependency (cascade: repeats naturally when a dependent is committed).
      // Rendered outside the commit modal (which just closed) — see commitPinWarning usage below.
      const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, sha)
      setCommitPinWarning(outcome)
    },
  })

  const stageMutation = useMutation({
    mutationFn: (filepath: string) => api.sync.stage(repoPath, filepath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync:status', repoPath] }),
  })

  const stageAllMutation = useMutation({
    mutationFn: () => api.sync.stageAll(repoPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync:status', repoPath] }),
  })

  const unstageMutation = useMutation({
    mutationFn: (filepath: string) => api.sync.unstage(repoPath, filepath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync:status', repoPath] }),
  })

  const unstageAllMutation = useMutation({
    mutationFn: () => api.sync.unstageAll(repoPath),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync:status', repoPath] }),
  })

  const discardMutation = useMutation({
    mutationFn: (filepath: string) => api.sync.discard(repoPath, filepath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      setDiscardConfirmPath(null)
    },
  })

  const discardAllMutation = useMutation({
    mutationFn: () => api.sync.discardAll(repoPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      setConfirmDiscardAll(false)
    },
  })

  function handleCheckout(name: string) {
    if (staged.length > 0 || unstaged.length > 0) {
      setCheckoutConfirm({ value: name, isCommit: false })
      return
    }
    checkout(name)
  }

  function handleCheckoutCommit(sha: string) {
    if (staged.length > 0 || unstaged.length > 0) {
      setCheckoutConfirm({ value: sha, isCommit: true })
      return
    }
    checkoutCommit(sha)
  }

  function confirmCheckout() {
    if (!checkoutConfirm) return
    if (checkoutConfirm.isCommit) checkoutCommit(checkoutConfirm.value)
    else checkout(checkoutConfirm.value)
    setCheckoutConfirm(null)
  }

  useModalHotkeys(() => setCheckoutConfirm(null), confirmCheckout, !checkoutConfirm || isBranchPending)
  // Enter stays Ctrl+Enter here (wired on the textarea below) — plain Enter must insert a
  // newline in a multi-line commit message, so only Escape is handled globally.
  useModalHotkeys(() => { setShowCommitModal(false); setCommitMessage('') }, undefined, !showCommitModal)

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 px-2 rounded hover:bg-hover transition-colors cursor-pointer select-none"
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => { setOpen(v => !v); selectRepo(repoPath) }}
      >
        <span className="text-ink-3 shrink-0">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        {node.isInterface ? (
          <GitFork size={14} className="text-chart-5 shrink-0" />
        ) : (
          <FolderGit2 size={14} className="text-ink-3 shrink-0" />
        )}
        <span className={`text-sm truncate ${isSelected ? 'font-semibold text-status-info' : 'font-medium text-ink'}`}>
          {node.label || node.name}
        </span>
        {isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-status-warning-solid shrink-0" title={t('sidebar.version.pendingChanges')} />
        )}
        {showIntegrationBadge && (
          <span
            className={`text-xs font-mono shrink-0 ${syncAlert ? 'text-status-warning' : 'text-ink-3'}`}
            title={t('sidebar.version.integrationBadgeTooltip', {
              branch: integrationInfo.integrationBranch, ahead: integrationInfo.ahead, behind: integrationInfo.behind,
            })}
          >
            {integrationInfo.ahead > 0 && `↑${integrationInfo.ahead}`}
            {integrationInfo.ahead > 0 && integrationInfo.behind > 0 && ' '}
            {integrationInfo.behind > 0 && `↓${integrationInfo.behind}`}
          </span>
        )}
        {syncAlert && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); resync(repoPath, node.label || node.name) }}
            disabled={anyResyncPending}
            title={t('layout.syncIndicator.resync')}
            className="shrink-0 ml-auto text-status-warning hover:bg-hover rounded p-0.5 disabled:opacity-30 transition-colors"
          >
            <ArrowDownUp size={13} className={resyncPending ? 'animate-pulse' : ''} />
          </button>
        )}
        {/* GH40: this repo's version graph — selects the repo (the /graph view follows the
            selection) without toggling the folder. The header's graph icon stays global. */}
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            selectRepo(repoPath)
            navigate({ to: '/graph', search: { projectId, sha: undefined } })
          }}
          title={t('sidebar.version.viewRepoGraph', { name: node.label || node.name })}
          className={`shrink-0 ${syncAlert ? '' : 'ml-auto'} text-ink-3 hover:text-ink hover:bg-hover rounded p-0.5 transition-colors`}
        >
          <History size={13} />
        </button>
        {/* T153: refresh (git pull) — always visible next to the repo name, blocked while dirty
            so a pull never has to merge on top of uncommitted work. */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); pullMutation.mutate() }}
          disabled={pullMutation.isPending || isDirty}
          title={isDirty ? t('sidebar.version.refreshBlockedDirty') : t('sidebar.version.refreshTooltip')}
          className="shrink-0 text-ink-3 hover:text-ink hover:bg-hover rounded p-0.5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <RefreshCw size={13} className={pullMutation.isPending ? 'animate-spin' : ''} />
        </button>
        {/* Branch combobox moved next to the repo name (T87) — always visible, open or closed,
            instead of a separate labelled "Checkout" row inside the expanded panel. */}
        <div className="w-32 shrink-0" onClick={e => e.stopPropagation()}>
          <BranchCombobox
            branches={allBranches}
            tags={allTags}
            currentBranch={currentBranch}
            onCheckout={handleCheckout}
            onCheckoutCommit={handleCheckoutCommit}
            onDelete={deleteBranch}
            onCreateNew={createBranch}
            isPending={isBranchPending}
            onOpenChange={setBranchDropdownOpen}
          />
        </div>
      </div>

      {(isCheckoutError || checkoutPinWarning) && (
        <div style={{ paddingLeft: `${8 + indent}px` }} className="px-3">
          {isCheckoutError && (
            <p className="text-xs text-status-danger leading-snug">
              {checkoutError instanceof Error ? checkoutError.message : t('sidebar.version.checkoutError')}
            </p>
          )}
          <PinPropagationWarning outcome={checkoutPinWarning} onDismiss={dismissPinWarning} />
        </div>
      )}

      {(setAside || (syncAlert && syncError)) && (
        <div style={{ paddingLeft: `${8 + indent}px` }} className="px-3 flex items-start gap-2">
          {setAside ? (
            <p className="text-xs text-status-info leading-snug flex-1">
              {t('layout.syncIndicator.setAside', { branch: setAside.branch })}
            </p>
          ) : (
            <p className="text-xs text-status-danger leading-snug flex-1 break-words">
              {t('layout.syncIndicator.lastError', { error: syncError })}
            </p>
          )}
          {setAside && (
            <button type="button" onClick={resetResync} className="text-xs text-ink-3 hover:text-ink shrink-0">✕</button>
          )}
        </div>
      )}

      {pullMutation.isError && (
        <div style={{ paddingLeft: `${8 + indent}px` }} className="px-3">
          <p className="text-xs text-status-danger leading-snug">
            {pullMutation.error instanceof Error ? pullMutation.error.message : t('sidebar.version.refreshError')}
          </p>
        </div>
      )}

      {open && (
        <div style={{ paddingLeft: `${8 + indent}px` }} className="pb-1">
          {/* ── Pousser (T86 — restaure la capacité perdue lors de la suppression de SyncBar) ── */}
          {ahead > 0 && (
            <div className="px-2 py-1 flex items-center justify-between">
              <span className="text-xs text-ink-2">
                {t('sidebar.version.pushCount', { count: ahead })}
              </span>
              <button type="button" onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
                className="btn-sm">
                {pushMutation.isPending ? t('sidebar.version.pushing') : t('sidebar.version.push')}
              </button>
            </div>
          )}
          {pushMutation.isError && (
            <p className="px-2 pt-0.5 text-xs text-status-danger leading-snug">
              {pushMutation.error instanceof Error ? pushMutation.error.message : t('sidebar.version.pushError')}
            </p>
          )}

          {/* T82: rendered outside the Stagés section (and outside the commit modal, which closes
              synchronously on commit success) — the commit empties the staged list, which hides
              that section (GH40), before the async pin propagation resolves. */}
          <div className="px-2">
            <PinPropagationWarning outcome={commitPinWarning} onDismiss={() => setCommitPinWarning(null)} />
          </div>

          {/* GH40: empty sections are hidden; both empty → a single "nothing to commit" line.
              Gated on syncStatus so it doesn't flash before the first status load. */}
          {syncStatus && !isDirty && (
            <p className="px-2 py-0.5 text-xs text-ink-3 italic">{t('sidebar.version.nothingToCommit')}</p>
          )}

          {/* ── Stagés ── */}
          {staged.length > 0 && (
          <div className={`px-2 py-1 ${unstaged.length > 0 ? 'border-b border-edge-subtle' : ''}`}>
            <div className="flex items-center justify-between mb-0.5">
              <p className="section-label">{t('sidebar.version.staged')} ({staged.length})</p>
              <div className="flex items-center gap-1">
                {staged.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setCommitMessage(''); setShowCommitModal(true) }}
                      className="btn-sm"
                    >
                      {t('sidebar.version.commitEllipsis')}
                    </button>
                    <button type="button" onClick={() => unstageAllMutation.mutate()}
                      disabled={unstageAllMutation.isPending}
                      className="text-xs px-1.5 py-0.5 text-ink-3 hover:text-ink hover:bg-hover rounded transition-colors disabled:opacity-50"
                      title={t('sidebar.version.unstageAll')}>
                      {unstageAllMutation.isPending ? '…' : '−'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <ul>
                {staged.map(({ path: filePath, marker }) => (
                  <li key={filePath} className="flex items-center gap-1 h-5 text-xs">
                    <span className={`font-mono font-bold w-3 shrink-0 ${
                      marker === 'A' ? 'text-status-success' : marker === 'D' ? 'text-status-danger' : 'text-status-warning'
                    }`}>{marker}</span>
                    <button
                      type="button"
                      onClick={() => navigate({ to: '/diff', search: { projectId, repoPath, filepath: filePath, commitSha: undefined } })}
                      className="flex-1 text-left font-mono text-ink-2 hover:text-ink truncate hover:underline"
                      title={filePath}
                    >{filePath}</button>
                    <button
                      type="button"
                      onClick={() => unstageMutation.mutate(filePath)}
                      disabled={unstageMutation.isPending}
                      className="shrink-0 text-ink-3 hover:text-ink hover:bg-hover rounded px-1 disabled:opacity-30"
                      title={t('sidebar.version.unstage')}
                    >−</button>
                  </li>
                ))}
            </ul>
          </div>
          )}

          {/* ── Modifications ── */}
          {unstaged.length > 0 && (
          <div className="px-2 py-1">
            <div className="flex items-center justify-between mb-0.5">
              <p className="section-label">{t('sidebar.version.modifications')} ({unstaged.length})</p>
              <div className="flex items-center gap-1">
                {unstaged.length > 0 && (
                  <>
                    <button type="button" onClick={() => stageAllMutation.mutate()}
                      disabled={stageAllMutation.isPending}
                      className="text-xs px-1.5 py-0.5 text-ink-3 hover:text-ink hover:bg-hover rounded transition-colors disabled:opacity-50"
                      title={t('sidebar.version.stageAll')}>
                      {stageAllMutation.isPending ? '…' : '+'}
                    </button>
                    {!confirmDiscardAll ? (
                      <button type="button" onClick={() => setConfirmDiscardAll(true)}
                        className="text-xs px-1.5 py-0.5 text-ink-3 hover:text-status-danger hover:bg-status-danger-bg rounded transition-colors"
                        title={t('sidebar.version.discardAll')}><Undo2 size={12} /></button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-1.5 py-0.5">
                        <span>{t('sidebar.version.discardAllConfirm')}</span>
                        <button type="button" onClick={() => discardAllMutation.mutate()}
                          disabled={discardAllMutation.isPending} className="font-medium hover:underline disabled:opacity-50">
                          {discardAllMutation.isPending ? '…' : t('common.yes')}
                        </button>
                        <button type="button" onClick={() => setConfirmDiscardAll(false)} className="text-ink-3 hover:underline">{t('common.no')}</button>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <ul>
                {unstaged.map(({ path: filePath, marker }) => (
                  <li key={filePath} className="flex items-center gap-1 h-5 text-xs">
                    <span className={`font-mono font-bold w-3 shrink-0 ${
                      marker === 'A' ? 'text-status-success' : marker === 'D' ? 'text-status-danger' : 'text-status-warning'
                    }`}>{marker}</span>
                    <button
                      type="button"
                      onClick={() => navigate({ to: '/diff', search: { projectId, repoPath, filepath: filePath, commitSha: undefined } })}
                      className="flex-1 text-left font-mono text-ink-2 hover:text-ink truncate hover:underline"
                      title={filePath}
                    >{filePath}</button>
                    <button
                      type="button"
                      onClick={() => stageMutation.mutate(filePath)}
                      disabled={stageMutation.isPending}
                      className="shrink-0 text-ink-3 hover:text-status-success hover:bg-status-success-bg rounded px-1 disabled:opacity-30"
                      title={t('sidebar.version.stage')}
                    >+</button>
                    {discardConfirmPath === filePath ? (
                      <span className="flex items-center gap-0.5 text-status-danger">
                        <button type="button" onClick={() => discardMutation.mutate(filePath)}
                          disabled={discardMutation.isPending}
                          className="font-medium hover:underline disabled:opacity-50 px-1">
                          {discardMutation.isPending ? '…' : '✓'}
                        </button>
                        <button type="button" onClick={() => setDiscardConfirmPath(null)}
                          className="text-ink-3 hover:underline px-1">✕</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDiscardConfirmPath(filePath)}
                        className="shrink-0 text-ink-3 hover:text-status-danger hover:bg-status-danger-bg rounded px-1"
                        title={t('sidebar.version.discardChanges')}
                      ><Undo2 size={12} /></button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
          )}
        </div>
      )}

      {node.children.map(child => (
        <VersionRepoFolder
          key={child.name}
          node={child}
          depth={depth + 1}
          projectId={projectId}
          workspaceDir={workspaceDir}
          flatNodes={flatNodes}
        />
      ))}

      {/* Checkout avec fichiers modifiés — confirmation */}
      {checkoutConfirm && (
        <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-5 w-full max-w-sm mx-4">
            <h2 className="font-semibold text-sm text-ink mb-2">{t('sidebar.version.changeBranchTitle')}</h2>
            <p className="text-xs text-ink-2 mb-4">
              <Trans
                i18nKey="sidebar.version.changeBranchBodyVersion"
                values={{ name: node.label || node.name, value: checkoutConfirm.value }}
                components={{ mono: <span className="font-mono font-medium" /> }}
              />
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCheckoutConfirm(null)} className="btn-secondary-sm">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmCheckout}
                className="btn-danger-sm"
              >
                {t('sidebar.version.forceCheckout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Commit modal */}
      {showCommitModal && (
        <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="font-semibold mb-4 text-sm text-ink">{t('sidebar.version.commitModalTitle', { name: node.label || node.name })}</h2>
            <textarea
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.ctrlKey && commitMessage.trim() && !commitMutation.isPending) {
                  e.preventDefault()
                  commitMutation.mutate()
                }
                if (e.key === 'Escape') {
                  setShowCommitModal(false)
                  setCommitMessage('')
                }
              }}
              placeholder={t('sidebar.version.commitMessagePlaceholder')}
              rows={3}
              className="input-field w-full resize-none mb-4"
              autoFocus
            />
            {commitMutation.isError && (
              <p className="text-sm text-status-danger mb-3">
                {commitMutation.error instanceof Error ? commitMutation.error.message : t('sidebar.version.commitError')}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setShowCommitModal(false); setCommitMessage('') }}
                className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => commitMutation.mutate()}
                disabled={!commitMessage.trim() || commitMutation.isPending}
                className="btn-primary"
              >
                {commitMutation.isPending ? t('sidebar.version.committing') : t('sidebar.version.commitAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
