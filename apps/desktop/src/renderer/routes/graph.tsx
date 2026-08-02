import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { propagatePinToDependents, type PinPropagationOutcome } from '../lib/workspaceActions'
import { PinPropagationWarning } from '../components/sidebar/version/PinPropagationWarning'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useSetTabTitle } from '../contexts/TabsContext'
import { toIntlLocale } from '../i18n/useLocale'
import type { GraphCommit, SyncFileStatus, MergeResult } from '@polenta/api-client'
import type { WorkspaceTreeNode } from '@polenta/types'

export const Route = createFileRoute('/graph')({
  component: GraphPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    sha: (s['sha'] as string) || undefined,
  }),
})

// ─── git graph layout ────────────────────────────────────────────────────────

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6',
  '#a855f7', '#22c55e',
]
const LANE_W = 14
const ROW_H  = 36
const DOT_R  = 3.5
const PAD    = 6

type Slot = { sha: string; ci: number } | null

interface RowData {
  commit:     GraphCommit
  lane:       number
  ci:         number
  before:     Slot[]
  incoming:   number[]
  extraLanes: number[]
  nCols:      number
}

function buildRows(commits: GraphCommit[]): RowData[] {
  const slots: Slot[] = []
  let nextCi = 0

  return commits.map(commit => {
    const before: Slot[] = slots.map(s => s ? { ...s } : null)

    const incoming = before.reduce<number[]>(
      (acc, s, i) => (s?.sha === commit.sha ? [...acc, i] : acc),
      [],
    )

    let lane: number
    let ci: number
    if (incoming.length > 0) {
      lane = incoming[0]
      ci   = before[lane]!.ci
      for (let k = 1; k < incoming.length; k++) slots[incoming[k]] = null
    } else {
      const free = slots.findIndex(s => !s)
      lane = free >= 0 ? free : slots.length
      if (free < 0) slots.push(null)
      ci = nextCi++ % COLORS.length
    }

    const [p0, ...rest] = commit.parents
    slots[lane] = p0 ? { sha: p0, ci } : null

    const extraLanes: number[] = []
    for (const p of rest) {
      const existing = slots.findIndex(s => s?.sha === p)
      if (existing >= 0) {
        extraLanes.push(existing)
      } else {
        const newCi  = nextCi++ % COLORS.length
        const free   = slots.findIndex(s => !s)
        const newLane = free >= 0 ? free : slots.length
        const slot: Slot = { sha: p, ci: newCi }
        if (free >= 0) slots[free] = slot; else slots.push(slot)
        extraLanes.push(newLane)
      }
    }

    while (slots.length && !slots[slots.length - 1]) slots.pop()

    const nCols = Math.max(before.length, slots.length, lane + 1)
    return { commit, lane, ci, before, incoming, extraLanes, nCols }
  })
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
  const my = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`
}

function GraphCell({ row, graphW }: { row: RowData; graphW: number }) {
  const { lane, ci, before, incoming, extraLanes, commit } = row
  const xOf = (col: number) => PAD + (col + 0.5) * LANE_W
  const cx = xOf(lane)
  const cy = ROW_H / 2

  const els: JSX.Element[] = []
  let k = 0

  for (let i = 0; i < before.length; i++) {
    const s = before[i]
    if (!s || incoming.includes(i)) continue
    const lx = xOf(i)
    els.push(
      <path key={k++} d={`M${lx} 0L${lx} ${ROW_H}`}
        stroke={COLORS[s.ci]} strokeWidth={1.5} fill="none" />,
    )
  }

  for (const il of incoming) {
    els.push(
      <path key={k++} d={bezier(xOf(il), 0, cx, cy)}
        stroke={COLORS[ci]} strokeWidth={1.5} fill="none" />,
    )
  }

  if (commit.parents.length > 0) {
    els.push(
      <path key={k++} d={`M${cx} ${cy}L${cx} ${ROW_H}`}
        stroke={COLORS[ci]} strokeWidth={1.5} fill="none" />,
    )
  }

  for (const el of extraLanes) {
    els.push(
      <path key={k++} d={bezier(cx, cy, xOf(el), ROW_H)}
        stroke={COLORS[ci]} strokeWidth={1.5} fill="none" />,
    )
  }

  if (commit.isCurrent) {
    els.push(
      <circle key="ring" cx={cx} cy={cy} r={DOT_R + 3}
        fill="none" stroke={COLORS[ci]} strokeWidth={1.5} opacity={0.4} />,
      <circle key="dot"  cx={cx} cy={cy} r={DOT_R}
        fill={COLORS[ci]} stroke="rgb(var(--status-info-fg))" strokeWidth={1.5} />,
    )
  } else {
    els.push(
      <circle key="dot" cx={cx} cy={cy} r={DOT_R} fill={COLORS[ci]} />,
    )
  }

  return (
    <svg width={graphW} height={ROW_H} style={{ display: 'block', flexShrink: 0 }}>
      {els}
    </svg>
  )
}

// ─── commit files panel ───────────────────────────────────────────────────────

function CommitFilesRow({
  sha, repoPath, projectId, graphW, colSpan,
}: {
  sha: string
  repoPath: string
  projectId: string
  graphW: number
  colSpan: number
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: files, isLoading, isError } = useQuery<SyncFileStatus[]>({
    queryKey: ['sync:commit-files', repoPath, sha],
    queryFn: () => api.sync.commitFiles(repoPath, sha),
    enabled: !!repoPath && !!sha,
    staleTime: Infinity,
  })

  return (
    <tr className="bg-status-info-bg/50 dark:bg-status-info-bg/5">
      <td colSpan={colSpan} className="px-0 py-0">
        <div style={{ paddingLeft: graphW + 8 }} className="pr-4 py-2 border-b border-status-info-border dark:border-status-info-border/30">
          {isLoading && (
            <div className="flex items-center gap-1.5 text-xs text-ink-3 py-1">
              <Loader2 size={11} className="animate-spin" />
              {t('common.loading')}
            </div>
          )}
          {isError && (
            <p className="text-xs text-status-danger py-1">{t('graphPage.errorLoadingFiles')}</p>
          )}
          {files && files.length === 0 && (
            <p className="text-xs text-ink-3 italic py-1">{t('sidebar.version.noModifiedFile')}</p>
          )}
          {files && files.length > 0 && (
            <ul className="space-y-0.5">
              {files.map(({ path: filePath, marker }) => (
                <li key={filePath} className="flex items-center gap-1.5 text-xs">
                  <span className={`font-mono font-bold w-3 shrink-0 ${
                    marker === 'A' ? 'text-status-success' : marker === 'D' ? 'text-status-danger' : 'text-status-warning'
                  }`}>{marker}</span>
                  <button
                    type="button"
                    onClick={() => navigate({ to: '/diff', search: { projectId, repoPath, filepath: filePath, commitSha: sha } })}
                    className="flex-1 text-left font-mono text-ink-2 hover:text-ink truncate hover:underline"
                    title={filePath}
                  >{filePath}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const BADGE_PALETTE = COLORS

function refColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return BADGE_PALETTE[h % BADGE_PALETTE.length]
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── context menu types ───────────────────────────────────────────────────────

type GraphContextMenuTarget =
  | { type: 'branch'; name: string; sha: string; isCurrent: boolean }
  | { type: 'tag';    name: string; sha: string }
  | { type: 'commit'; sha: string; isCurrent: boolean }

interface GraphContextMenuState {
  x: number
  y: number
  target: GraphContextMenuTarget
}

// ─── GraphContextMenu component ───────────────────────────────────────────────

interface GraphContextMenuProps {
  state: GraphContextMenuState
  repoPath: string
  isClean: boolean
  currentBranch: string
  allBranches: string[]
  headSha: string
  projectId: string
  /** Workspace root directory and the full repo list — needed to propagate a checkout's new
   *  pin to dependents (T82) now that `repoPath` isn't guaranteed to be the root (T88). */
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
  /** The selected repo's own node ({name, url}) — undefined only while flatNodes hasn't
   *  resolved yet, in which case pin propagation is skipped for that checkout. */
  node: WorkspaceTreeNode | undefined
  onClose: () => void
  onInvalidate: (keys: Array<'status' | 'graph' | 'branches' | 'tags'>) => void
  onPinWarning: (outcome: PinPropagationOutcome) => void
}

function GraphContextMenu({
  state, repoPath, isClean, currentBranch, allBranches, headSha, projectId,
  workspaceDir, flatNodes, node, onClose, onInvalidate, onPinWarning,
}: GraphContextMenuProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { target } = state
  const ref = useRef<HTMLDivElement>(null)

  // State for destructive confirmation
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  // State for inline prompts (create branch / create tag)
  const [inlinePrompt, setInlinePrompt] = useState<{ mode: 'branch' | 'tag'; value: string } | null>(null)
  // State for branch selector ('diff' = diff vs branche, 'merge' = merger dans…)
  const [selectorMode, setSelectorMode] = useState<'diff' | 'merge' | null>(null)
  // Per-mutation error messages
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Adjust position to avoid overflow
  const [pos, setPos] = useState({ left: state.x, top: state.y })
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const left = Math.min(state.x, window.innerWidth  - rect.width  - 8)
    const top  = Math.min(state.y, window.innerHeight - rect.height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [state.x, state.y])

  // ── mutations ───────────────────────────────────────────────────────────────

  function handleMutationError(err: unknown) {
    setMutationError(err instanceof Error ? err.message : String(err))
  }

  const checkoutBranchMut = useMutation({
    mutationFn: (name: string) => api.sync.checkoutBranch(repoPath, name),
    onSuccess: async (_data, name) => {
      onInvalidate(['status', 'graph', 'branches'])
      onClose()
      if (node) onPinWarning(await propagatePinToDependents(workspaceDir, flatNodes, node, name))
    },
    onError: handleMutationError,
  })

  const checkoutCommitMut = useMutation({
    mutationFn: (sha: string) => api.sync.checkoutCommit(repoPath, sha),
    onSuccess: async (_data, sha) => {
      onInvalidate(['status', 'graph', 'branches'])
      onClose()
      if (node) onPinWarning(await propagatePinToDependents(workspaceDir, flatNodes, node, sha))
    },
    onError: handleMutationError,
  })

  const mergeMut = useMutation({
    mutationFn: (fromBranch: string) => api.sync.merge(repoPath, fromBranch),
    onSuccess: (result: MergeResult) => {
      if (!result.success) {
        setMutationError(t('graphPage.mergeConflicts', { conflicts: result.conflicts.join(', ') }))
        return
      }
      onInvalidate(['status', 'graph'])
      onClose()
    },
    onError: handleMutationError,
  })

  const mergeIntoMut = useMutation({
    mutationFn: ({ from, into }: { from: string; into: string }) => api.sync.mergeInto(repoPath, from, into),
    onSuccess: (result: MergeResult) => {
      if (!result.success) {
        setMutationError(t('graphPage.mergeConflicts', { conflicts: result.conflicts.join(', ') }))
        return
      }
      onInvalidate(['status', 'graph'])
      onClose()
    },
    onError: handleMutationError,
  })

  const rebaseMut = useMutation({
    mutationFn: (onto: string) => api.sync.rebase(repoPath, onto),
    onSuccess: () => { onInvalidate(['status', 'graph']); onClose() },
    onError: handleMutationError,
  })

  const pushBranchMut = useMutation({
    mutationFn: (branchName: string) => api.sync.pushBranch(repoPath, branchName),
    onSuccess: () => { onInvalidate(['status']); onClose() },
    onError: handleMutationError,
  })

  const deleteBranchMut = useMutation({
    mutationFn: (name: string) => api.sync.deleteBranch(repoPath, name),
    onSuccess: () => { onInvalidate(['graph', 'branches']); onClose() },
    onError: handleMutationError,
  })

  const deleteRemoteBranchMut = useMutation({
    mutationFn: (name: string) => api.sync.deleteRemoteBranch(repoPath, name),
    onSuccess: () => { onInvalidate(['graph']); onClose() },
    onError: handleMutationError,
  })

  const deleteTagMut = useMutation({
    mutationFn: (tagName: string) => api.sync.deleteTag(repoPath, tagName),
    onSuccess: () => { onInvalidate(['graph', 'tags']); onClose() },
    onError: handleMutationError,
  })

  const createBranchAtMut = useMutation({
    mutationFn: ({ name, sha }: { name: string; sha: string }) => api.sync.createBranchAt(repoPath, name, sha),
    onSuccess: () => { onInvalidate(['graph', 'branches']); onClose() },
    onError: handleMutationError,
  })

  const createTagMut = useMutation({
    mutationFn: ({ name, sha }: { name: string; sha: string }) => api.sync.createTag(repoPath, name, sha),
    onSuccess: () => { onInvalidate(['graph', 'tags']); onClose() },
    onError: handleMutationError,
  })

  // ── helpers ─────────────────────────────────────────────────────────────────

  function handleDestructive(itemId: string, action: () => void) {
    if (pendingConfirm === itemId) {
      action()
      setPendingConfirm(null)
    } else {
      setPendingConfirm(itemId)
    }
  }

  function handleDiffVsHead(sha: string) {
    navigate({ to: '/version-diff', search: { projectId, repoPath, ref1: undefined, sha1: sha, ref2: undefined, sha2: headSha } })
    onClose()
  }

  function handleDiffVsBranch(sha: string, ref2: string) {
    navigate({ to: '/version-diff', search: { projectId, repoPath, ref1: undefined, sha1: sha, ref2, sha2: undefined } })
    onClose()
  }

  function handleInlineSubmit(sha: string) {
    if (!inlinePrompt || !inlinePrompt.value.trim()) return
    const name = inlinePrompt.value.trim()
    if (inlinePrompt.mode === 'branch') {
      createBranchAtMut.mutate({ name, sha })
    } else {
      createTagMut.mutate({ name, sha })
    }
    setInlinePrompt(null)
  }

  // ── shared item classes ──────────────────────────────────────────────────────

  const baseItem = 'w-full text-left px-3 py-1.5 hover:bg-hover transition-colors flex items-center gap-2 text-ink'
  const dangerItem = 'w-full text-left px-3 py-1.5 hover:bg-status-danger-bg transition-colors flex items-center gap-2 text-status-danger'
  const confirmItem = 'w-full text-left px-3 py-1.5 bg-status-danger-bg transition-colors flex items-center gap-2 text-status-danger font-semibold'

  // ── inline branch selector ────────────────────────────────────────────────────

  if (selectorMode === 'diff' || selectorMode === 'merge') {
    const sha = target.type !== 'commit' ? (target as { sha: string }).sha : target.sha
    const sourceName = target.type === 'branch' ? target.name : target.type === 'tag' ? target.name : sha.slice(0, 7)
    const title = selectorMode === 'merge'
      ? t('graphPage.mergeInto', { source: sourceName })
      : t('graphPage.diffVsBranch')
    return createPortal(
      <div
        ref={ref}
        className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-64 text-xs"
        style={pos}
      >
        <p className="px-3 py-1.5 text-ink-3 font-medium">{title}</p>
        <div className="border-t border-edge my-1" />
        <div className="max-h-48 overflow-y-auto">
          {allBranches.map(branch => (
            <button
              key={branch}
              type="button"
              className={baseItem}
              disabled={selectorMode === 'merge' && mergeIntoMut.isPending}
              onClick={() => {
                if (selectorMode === 'merge') {
                  mergeIntoMut.mutate({ from: sourceName, into: branch })
                } else {
                  handleDiffVsBranch(sha, branch)
                  setSelectorMode(null)
                }
              }}
            >
              {selectorMode === 'merge' && mergeIntoMut.isPending
                ? <Loader2 size={11} className="animate-spin" />
                : null
              }
              {branch}
            </button>
          ))}
        </div>
        <div className="border-t border-edge my-1" />
        <button type="button" className={baseItem} onClick={() => setSelectorMode(null)}>
          {t('layout.viewHeader.back')}
        </button>
      </div>,
      document.body,
    )
  }

  // ── inline prompt ─────────────────────────────────────────────────────────────

  const targetSha = target.type !== 'commit'
    ? (target as { sha: string }).sha
    : target.sha

  if (inlinePrompt) {
    return createPortal(
      <div
        ref={ref}
        className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 w-64 text-xs"
        style={pos}
      >
        <p className="text-ink font-medium mb-2">
          {inlinePrompt.mode === 'branch' ? t('graphPage.branchNameLabel') : t('graphPage.tagNameLabel')}
        </p>
        <input
          autoFocus
          type="text"
          value={inlinePrompt.value}
          onChange={e => setInlinePrompt({ ...inlinePrompt, value: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') handleInlineSubmit(targetSha)
            if (e.key === 'Escape') onClose()
          }}
          placeholder={inlinePrompt.mode === 'branch' ? 'feature/ma-branche' : 'v1.0.0'}
          className="w-full border border-edge rounded px-2 py-1 text-xs bg-surface text-ink outline-none focus:border-status-info mb-2"
        />
        {mutationError && (
          <p className="text-status-danger text-xs mb-2">{mutationError}</p>
        )}
        {(createBranchAtMut.isPending || createTagMut.isPending) && (
          <div className="flex items-center gap-1.5 text-xs text-ink-3 mb-2">
            <Loader2 size={11} className="animate-spin" /> {t('graphPage.inProgress')}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleInlineSubmit(targetSha)}
            disabled={createBranchAtMut.isPending || createTagMut.isPending || !inlinePrompt.value.trim()}
            className="flex-1 bg-status-info-solid text-status-info-fg rounded px-2 py-1 hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            {t('sidebar.version.validate')}
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            className="flex-1 border border-edge rounded px-2 py-1 hover:bg-hover transition-colors text-ink"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>,
      document.body,
    )
  }

  // ── main menu ─────────────────────────────────────────────────────────────────

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-56 text-xs"
      style={pos}
    >
      {mutationError && (
        <p className="px-3 py-1.5 text-status-danger leading-snug">{mutationError}</p>
      )}

      {/* ── BRANCH MENU ─────────────────────────────────────────── */}
      {target.type === 'branch' && (() => {
        const { name, sha, isCurrent } = target
        const isPushPending   = pushBranchMut.isPending
        const isCheckoutPend  = checkoutBranchMut.isPending
        const isMergePending  = mergeMut.isPending
        const isRebasePending = rebaseMut.isPending
        const isDelLocalPend  = deleteBranchMut.isPending
        const isDelRemotePend = deleteRemoteBranchMut.isPending

        return (
          <>
            {isClean && !isCurrent && (
              <button type="button" className={baseItem} disabled={isCheckoutPend}
                onClick={() => checkoutBranchMut.mutate(name)}>
                {isCheckoutPend ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('graphPage.checkoutBranch')}
              </button>
            )}

            {isClean && !isCurrent && <div className="border-t border-edge my-1" />}
            <button type="button" className={baseItem}
              disabled={isMergePending || mergeIntoMut.isPending}
              onClick={() => setSelectorMode('merge')}>
              {(isMergePending || mergeIntoMut.isPending) ? <Loader2 size={11} className="animate-spin" /> : null}
              {t('graphPage.mergeBranchInto')}
            </button>
            {!isCurrent && isClean && (
              <button type="button" className={baseItem} disabled={isRebasePending}
                onClick={() => rebaseMut.mutate(name)}>
                {isRebasePending ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('graphPage.rebaseCurrentOnBranch')}
              </button>
            )}

            <div className="border-t border-edge my-1" />

            <button type="button" className={baseItem} disabled={isPushPending}
              onClick={() => pushBranchMut.mutate(name)}>
              {isPushPending ? <Loader2 size={11} className="animate-spin" /> : null}
              {t('graphPage.pushBranch')}
            </button>
            {!isCurrent && (
              <button type="button"
                className={pendingConfirm === 'del-local' ? confirmItem : dangerItem}
                disabled={isDelLocalPend}
                onClick={() => handleDestructive('del-local', () => deleteBranchMut.mutate(name))}>
                {isDelLocalPend ? <Loader2 size={11} className="animate-spin" /> : null}
                {pendingConfirm === 'del-local' ? t('graphPage.confirm') : t('graphPage.deleteLocalBranch')}
              </button>
            )}
            <button type="button"
              className={pendingConfirm === 'del-remote' ? confirmItem : dangerItem}
              disabled={isDelRemotePend}
              onClick={() => handleDestructive('del-remote', () => deleteRemoteBranchMut.mutate(name))}>
              {isDelRemotePend ? <Loader2 size={11} className="animate-spin" /> : null}
              {pendingConfirm === 'del-remote' ? t('graphPage.confirm') : t('graphPage.deleteRemoteBranch')}
            </button>

            <div className="border-t border-edge my-1" />

            {!isCurrent && (
              <button type="button" className={baseItem} onClick={() => handleDiffVsHead(sha)}>
                {t('graphPage.diffBranchVsHead')}
              </button>
            )}
            <button type="button" className={baseItem} onClick={() => setSelectorMode('diff')}>
              {t('graphPage.diffBranchVsBranch')}
            </button>
          </>
        )
      })()}

      {/* ── TAG MENU ────────────────────────────────────────────── */}
      {target.type === 'tag' && (() => {
        const { name, sha } = target
        const isDelTagPend = deleteTagMut.isPending

        return (
          <>
            {isClean && (
              <button type="button" className={baseItem} disabled={checkoutCommitMut.isPending}
                onClick={() => checkoutCommitMut.mutate(sha)}>
                {checkoutCommitMut.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('graphPage.checkoutTag')}
              </button>
            )}

            <div className="border-t border-edge my-1" />

            <button type="button" className={baseItem}
              onClick={() => setInlinePrompt({ mode: 'branch', value: '' })}>
              {t('graphPage.createBranchFromTag')}
            </button>

            <div className="border-t border-edge my-1" />

            <button type="button"
              className={pendingConfirm === 'del-tag' ? confirmItem : dangerItem}
              disabled={isDelTagPend}
              onClick={() => handleDestructive('del-tag', () => deleteTagMut.mutate(name))}>
              {isDelTagPend ? <Loader2 size={11} className="animate-spin" /> : null}
              {pendingConfirm === 'del-tag' ? t('graphPage.confirm') : t('graphPage.deleteTag')}
            </button>

            <div className="border-t border-edge my-1" />

            <button type="button" className={baseItem} onClick={() => handleDiffVsHead(sha)}>
              {t('graphPage.diffTagVsHead')}
            </button>
            <button type="button" className={baseItem} onClick={() => setSelectorMode('diff')}>
              {t('graphPage.diffTagVsBranch')}
            </button>
          </>
        )
      })()}

      {/* ── COMMIT MENU ─────────────────────────────────────────── */}
      {target.type === 'commit' && (() => {
        const { sha, isCurrent } = target
        const isCheckoutPend  = checkoutCommitMut.isPending
        const isRebasePending = rebaseMut.isPending

        return (
          <>
            {isClean && !isCurrent && (
              <button type="button" className={baseItem} disabled={isCheckoutPend}
                onClick={() => checkoutCommitMut.mutate(sha)}>
                {isCheckoutPend ? <Loader2 size={11} className="animate-spin" /> : null}
                {t('graphPage.checkoutCommit')}
              </button>
            )}

            <div className="border-t border-edge my-1" />

            <button type="button" className={baseItem}
              onClick={() => setInlinePrompt({ mode: 'branch', value: '' })}>
              {t('graphPage.createBranchFromCommit')}
            </button>
            <button type="button" className={baseItem}
              onClick={() => setInlinePrompt({ mode: 'tag', value: '' })}>
              {t('graphPage.createTagOnCommit')}
            </button>

            {!isCurrent && isClean && (
              <>
                <div className="border-t border-edge my-1" />
                <button type="button" className={baseItem} disabled={isRebasePending}
                  onClick={() => rebaseMut.mutate(sha)}>
                  {isRebasePending ? <Loader2 size={11} className="animate-spin" /> : null}
                  {t('graphPage.rebaseCurrentOnCommit')}
                </button>
              </>
            )}

            {!isCurrent && (
              <>
                <div className="border-t border-edge my-1" />
                <button type="button" className={baseItem} onClick={() => handleDiffVsHead(sha)}>
                  {t('graphPage.diffCommitVsHead')}
                </button>
              </>
            )}
            {isCurrent && <div className="border-t border-edge my-1" />}
            <button type="button" className={baseItem} onClick={() => setSelectorMode('diff')}>
              {t('graphPage.diffCommitVsBranch')}
            </button>
          </>
        )
      })()}
    </div>,
    document.body,
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

function GraphPage() {
  const { t, i18n } = useTranslation()
  const { projectId, sha: initialSha } = Route.useSearch()
  const qc = useQueryClient()

  const [selectedSha, setSelectedSha] = useState<string>(initialSha ?? '')
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null)
  const [pinWarning, setPinWarning] = useState<PinPropagationOutcome | null>(null)

  useEffect(() => {
    if (initialSha) setSelectedSha(initialSha)
  }, [initialSha])

  // Follows whichever repo is selected in the Version panel's tree (T88 — this view
  // previously always showed the workspace root regardless of that selection).
  const { selectedRepoPath, rootRepoPath } = useSelectedRepo()
  const workspaceDir = decodeProjectId(projectId)
  const { flatNodes } = useWorkspaceStructure(workspaceDir, rootRepoPath)
  const repoPath = selectedRepoPath
  const selectedNode = flatNodes.find(n => n.repoPath === repoPath)
  const repoName = selectedNode?.label || selectedNode?.name
  useSetTabTitle(repoName ? t('graphPage.tabTitle', { repoName }) : undefined)

  const { data: syncStatus } = useQuery({
    queryKey:        ['sync:status', repoPath],
    queryFn:         () => api.sync.status(repoPath),
    enabled:         !!repoPath,
    refetchInterval: 5000,
  })

  const { data: commits = [], isLoading } = useQuery<GraphCommit[]>({
    queryKey:        ['sync:graph', repoPath],
    queryFn:         () => api.sync.graph(repoPath),
    enabled:         !!repoPath,
    refetchInterval: 10_000,
  })

  // Tags query for discriminating badge types
  const { data: tagList = [] } = useQuery<string[]>({
    queryKey:  ['sync:tags', repoPath],
    queryFn:   () => api.sync.tags(repoPath),
    enabled:   !!repoPath,
    staleTime: 30_000,
  })
  const tagSet = new Set(tagList)

  const isClean = !syncStatus || (syncStatus.staged.length === 0 && syncStatus.unstaged.length === 0)
  const currentBranch = syncStatus?.branch ?? ''

  // Derive all branch names from commits refs (excluding tags)
  const allBranches = Array.from(
    new Set(
      commits.flatMap(c => c.refs.filter(r => !tagSet.has(r)))
    )
  )

  // HEAD sha = sha of the commit that isCurrent
  const headSha = commits.find(c => c.isCurrent)?.sha ?? ''

  const checkoutMutation = useMutation({
    mutationFn: (sha: string) => api.sync.checkoutCommit(repoPath, sha),
    onSuccess: async (_data, sha) => {
      qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:graph', repoPath] })
      qc.invalidateQueries({ queryKey: ['action:current', repoPath] })
      // T82/T88: this repo's HEAD just moved — propose the new SHA as pin wherever this
      // repo is declared as a dependency (a no-op when repoPath is the workspace root,
      // which nothing depends on).
      if (selectedNode) setPinWarning(await propagatePinToDependents(workspaceDir, flatNodes, selectedNode, sha))
    },
  })

  const rows    = buildRows(commits)
  const maxCols = rows.reduce((m, r) => Math.max(m, r.nCols), 1)
  const graphW  = PAD * 2 + (maxCols + 0.5) * LANE_W
  const COL_SPAN = 6

  function toggleSha(sha: string) {
    setSelectedSha(prev => prev === sha ? '' : sha)
  }

  function openContextMenu(e: React.MouseEvent, target: GraphContextMenuTarget) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, target })
    setMutationErrors({})
  }

  // Track mutation errors for inline display (unused directly — handled inside component)
  const [, setMutationErrors] = useState<Record<string, string>>({})

  const handleInvalidate = useCallback((keys: Array<'status' | 'graph' | 'branches' | 'tags'>) => {
    for (const key of keys) {
      switch (key) {
        case 'status':
          qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
          qc.invalidateQueries({ queryKey: ['action:current', repoPath] })
          break
        case 'graph':
          qc.invalidateQueries({ queryKey: ['sync:graph', repoPath] })
          break
        case 'branches':
          qc.invalidateQueries({ queryKey: ['sync:branches', repoPath] })
          break
        case 'tags':
          qc.invalidateQueries({ queryKey: ['sync:tags', repoPath] })
          break
      }
    }
  }, [qc, repoPath])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={
          <>
            {repoName ? t('graphPage.tabTitle', { repoName }) : t('layout.tabTitles.graph')}
            {syncStatus?.branch && (
              <span className="ml-2 text-xs font-mono text-ink-3 font-normal">
                ⎇ {syncStatus.branch}
              </span>
            )}
          </>
        }
      />
      {pinWarning && (pinWarning.conflicted.length > 0 || pinWarning.failed.length > 0) && (
        <div className="px-6 pt-3 shrink-0">
          <PinPropagationWarning outcome={pinWarning} onDismiss={() => setPinWarning(null)} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-ink-3 italic px-6 py-8">{t('common.loading')}</p>
        ) : commits.length === 0 ? (
          <p className="text-sm text-ink-3 italic px-6 py-8">{t('graphPage.noCommit')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface border-b border-edge z-10">
              <tr className="text-xs text-ink-3 uppercase tracking-wide">
                <th style={{ width: graphW }} className="py-2" />
                <th className="text-left px-2 py-2 w-20">SHA</th>
                <th className="text-left px-2 py-2">{t('graphPage.colMessage')}</th>
                <th className="text-left px-2 py-2 w-32">{t('graphPage.colAuthor')}</th>
                <th className="text-left px-2 py-2 w-28">{t('graphPage.colDate')}</th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <React.Fragment key={row.commit.sha}>
                  <tr
                    onClick={() => toggleSha(row.commit.sha)}
                    onContextMenu={e => {
                      e.preventDefault()
                      openContextMenu(e, {
                        type: 'commit',
                        sha: row.commit.sha,
                        isCurrent: row.commit.isCurrent,
                      })
                    }}
                    className={`border-b border-edge-subtle transition-colors cursor-pointer ${
                      selectedSha === row.commit.sha
                        ? 'bg-status-info-bg dark:bg-status-info-bg/15'
                        : row.commit.isCurrent
                        ? 'bg-status-info-bg/40 dark:bg-status-info-bg/5 hover:bg-hover'
                        : 'hover:bg-hover'
                    }`}
                  >
                    <td className="p-0 align-middle">
                      <GraphCell row={row} graphW={graphW} />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-ink-3">{row.commit.short}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {selectedSha === row.commit.sha
                          ? <ChevronDown size={12} className="shrink-0 text-status-info" />
                          : <ChevronRight size={12} className="shrink-0 text-ink-3" />
                        }
                        {row.commit.refs.map(ref => {
                          const isTag = tagSet.has(ref)
                          const isCurrentBranch = !isTag && ref === currentBranch
                          return (
                            <span
                              key={ref}
                              onContextMenu={e => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (isTag) {
                                  openContextMenu(e, {
                                    type: 'tag',
                                    name: ref,
                                    sha: row.commit.sha,
                                  })
                                } else {
                                  openContextMenu(e, {
                                    type: 'branch',
                                    name: ref,
                                    sha: row.commit.sha,
                                    isCurrent: isCurrentBranch,
                                  })
                                }
                              }}
                              className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0 cursor-context-menu"
                              style={{
                                backgroundColor: refColor(ref) + '20',
                                color:           refColor(ref),
                                border:          `1px solid ${refColor(ref)}40`,
                                outline:         isTag ? `1px dashed ${refColor(ref)}60` : undefined,
                              }}
                              title={isTag ? t('graphPage.tagLabel', { ref }) : isCurrentBranch ? t('graphPage.branchLabelCurrent', { ref }) : t('graphPage.branchLabel', { ref })}
                            >
                              {ref}
                            </span>
                          )
                        })}
                        <span className="text-ink truncate">{row.commit.message}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-ink-3 text-xs truncate">{row.commit.author}</td>
                    <td className="px-2 py-2 text-ink-3 text-xs whitespace-nowrap">{formatDate(row.commit.date, i18n.language)}</td>
                    <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
                      {!row.commit.isCurrent && isClean && (
                        <button
                          type="button"
                          onClick={() => checkoutMutation.mutate(row.commit.sha)}
                          disabled={checkoutMutation.isPending}
                          className="text-xs text-ink-3 hover:text-ink border border-edge rounded px-1.5 py-0.5 hover:bg-hover disabled:opacity-40 transition-colors"
                          title={t('graphPage.checkoutThisCommit')}
                        >
                          {checkoutMutation.isPending ? '…' : '⎇'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {selectedSha === row.commit.sha && repoPath && (
                    <CommitFilesRow
                      sha={row.commit.sha}
                      repoPath={repoPath}
                      projectId={projectId}
                      graphW={graphW}
                      colSpan={COL_SPAN}
                    />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {contextMenu && (
        <GraphContextMenu
          state={contextMenu}
          repoPath={repoPath}
          isClean={isClean}
          currentBranch={currentBranch}
          allBranches={allBranches}
          headSha={headSha}
          projectId={projectId}
          workspaceDir={workspaceDir}
          flatNodes={flatNodes}
          node={selectedNode}
          onClose={() => setContextMenu(null)}
          onInvalidate={handleInvalidate}
          onPinWarning={setPinWarning}
        />
      )}
    </div>
  )
}
