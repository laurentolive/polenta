import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle, Check, GitBranchPlus } from 'lucide-react'
import type { WorkspaceTreeNode } from '@polenta/types'
import { api } from '../../api'
import { designateNotices, useDesignateIntegration } from '../../hooks/useDesignateIntegration'
import { branchErrorText } from '../../lib/branchErrors'
import { BranchNotices } from '../sidebar/version/BranchNotices'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'
import { CheckoutConfirmModal } from './CheckoutConfirmModal'
import { NewIntegrationBranchModal, type NewIntegrationRequest } from './NewIntegrationBranchModal'

/**
 * GH106 — « Intégration : int-X » sur la ligne de chaque repo de l'onglet Structure (spec GH103
 * §1.1, design §3.4). Le menu désigne une `int-*` existante (checkout si besoin, sous la garde des
 * modifications en attente) ou en crée une. Pastille : `incoherent` (la branche courante est une
 * `int-*` non désignée — cas PH2) ou `nonConvention` (intégration sans préfixe `int-`). En detached
 * HEAD (composant épinglé sur un commit, baseline), le menu reste actif : choisir une branche en
 * fait le checkout. Seule une modification en cours (`dev-*`) le verrouille.
 * Pas de polling serré : rafraîchi toutes les 10 s et à l'ouverture du menu.
 */
export function IntegrationBranchMenu({ node, workspaceDir, flatNodes }: {
  node: { repoPath: string; name: string; label?: string }
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
}) {
  const { t } = useTranslation()
  const { repoPath } = node
  const [open, setOpen] = useState(false)
  const [showNew, setShowNew] = useState(false)
  // Action waiting for the pending-changes confirmation (a checkout is about to happen).
  const [confirm, setConfirm] = useState<{ value: string; run: () => void; cancel?: () => void } | null>(null)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const { data: state, refetch } = useQuery({
    queryKey: ['integration:state', repoPath],
    queryFn: () => api.integration.state(repoPath),
    enabled: !!repoPath,
    refetchInterval: 10_000,
  })
  const { data: status } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: !!repoPath,
    refetchInterval: 3000,
  })
  const isDirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) > 0
  const designation = useDesignateIntegration(workspaceDir, flatNodes)

  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return
      close()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open, close])

  if (!state) return null
  const detached = state.status === 'detached'
  // Same rule as RepoBranchSelector (T83): no checkout away from a modification in progress —
  // leaving a `dev-*` branch goes through "Publier".
  const inModification = state.currentBranch.startsWith('dev-')
  const locked = inModification
  // "Current integration" start point: the designated branch, or the current position when the
  // designation is only the `main` fallback (that branch may not even exist). Detached HEAD: the
  // designated branch if it exists, else the pinned commit ('' = stay where HEAD is).
  const startBranch = detached
    ? (state.candidates.some(c => c.name === state.configured) ? state.configured : '')
    : state.status === 'nonConvention' ? state.currentBranch : state.configured

  function toggle() {
    if (locked || designation.isPending) return
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left })
      void refetch()
    }
    setOpen(o => !o)
  }

  /** Runs `run` now, or after the pending-changes confirmation when it starts with a checkout. */
  function guarded(needsCheckout: boolean, value: string, run: () => void, cancel?: () => void) {
    if (needsCheckout && isDirty) setConfirm({ value, run, cancel })
    else run()
  }

  function designate(branch: string) {
    close()
    designation.reset()
    guarded(branch !== state!.currentBranch, branch, () => designation.designate(repoPath, branch))
  }

  /** `false` : confirmation des modifications en attente refusée, rien n'a été fait. */
  function create(req: NewIntegrationRequest): Promise<boolean> {
    // From the current integration while checked out elsewhere: back to it first, then branch off
    // (and back to where the user was if the creation fails).
    const checkoutFirst = !req.from && startBranch && state!.currentBranch !== startBranch
      ? { branch: startBranch, returnTo: state!.currentBranch || state!.headOid }
      : undefined
    designation.reset()
    return new Promise<boolean>((resolve, reject) => {
      guarded(
        !!req.from || !!checkoutFirst,
        req.from?.tag ?? checkoutFirst?.branch ?? '',
        () => { designation.create(repoPath, req.suffix, { from: req.from, checkoutFirst }).then(() => resolve(true), reject) },
        () => resolve(false),
      )
    })
  }

  const notices = [
    ...(designation.outcome ? designateNotices(designation.outcome, t) : []),
    // A failed creation is reported by its dialog, which stays open.
    ...(designation.error && designation.lastKind === 'designate' ? [branchErrorText(designation.error)] : []),
  ]

  return (
    <div className="shrink-0" onClick={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={locked || designation.isPending}
        className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink disabled:opacity-60 disabled:cursor-default"
        title={
          inModification ? t('sidebar.version.modificationInProgress')
            : detached ? t('schema.integrationMenu.detachedHint', { commit: state.headOid.slice(0, 7) })
              : state.status === 'incoherent' ? t('schema.integrationMenu.incoherentHint', { branch: state.currentBranch, configured: state.configured })
                : state.status === 'nonConvention' ? t('schema.integrationMenu.nonConventionHint') : undefined
        }
        aria-label={t('schema.integrationMenu.ariaLabel', { repo: node.label || node.name, branch: state.configured })}
      >
        {state.status === 'incoherent' && <AlertTriangle size={12} className="text-status-warning shrink-0" />}
        {state.status === 'nonConvention' && <span className="w-1.5 h-1.5 rounded-full bg-ink-3 shrink-0" />}
        <span>
          <Trans
            i18nKey="schema.integrationMenu.label"
            values={{ branch: state.configured }}
            components={{ mono: <span className="font-mono" /> }}
          />
        </span>
        {!locked && <span className="text-[10px]">▾</span>}
      </button>

      <BranchNotices notices={notices} onDismiss={designation.reset} />
      <PinPropagationWarning outcome={designation.pinWarning} onDismiss={designation.dismissPinWarning} />

      {open && createPortal(
        <div
          ref={dropRef}
          role="menu"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
          className="bg-surface border border-edge rounded-lg shadow-xl overflow-hidden min-w-56"
        >
          <ul className="max-h-60 overflow-y-auto py-0.5">
            {state.status === 'incoherent' && (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => designate(state.currentBranch)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-status-warning hover:bg-hover"
                >
                  <AlertTriangle size={11} className="shrink-0" />
                  {t('schema.integrationMenu.designateCurrent', { branch: state.currentBranch })}
                </button>
              </li>
            )}
            {state.candidates.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-3 italic">{t('schema.integrationMenu.none')}</li>
            )}
            {state.candidates.map(c => {
              const selected = c.name === state.configured
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    // Detached: the designated branch is not checked out yet — choosing it does.
                    onClick={() => (selected && !detached ? close() : designate(c.name))}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono hover:bg-hover ${selected ? 'text-status-info' : 'text-ink'}`}
                  >
                    {selected ? <Check size={11} className="shrink-0" /> : <span className="w-[11px] shrink-0" />}
                    <span className="truncate">{c.name}</span>
                    {c.remoteOnly && <span className="ml-auto shrink-0 text-[10px] text-ink-3 font-sans">{t('schema.integrationMenu.remote')}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-edge">
            <button
              type="button"
              role="menuitem"
              onClick={() => { close(); setShowNew(true) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-ink hover:bg-hover"
            >
              <GitBranchPlus size={11} className="shrink-0" />
              {t('schema.integrationMenu.newBranch')}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Portaled: rendered inside the row's DOM they would inherit its `select-none` and start a
          native drag of the (draggable) row when selecting text in the name field. */}
      {showNew && createPortal(
        <NewIntegrationBranchModal
          repoPath={repoPath}
          repoLabel={node.label || node.name}
          configured={startBranch}
          atCommit={startBranch ? undefined : state.headOid.slice(0, 7)}
          taken={state.candidates.map(c => c.name)}
          onCancel={() => setShowNew(false)}
          onSubmit={async req => { if (await create(req)) setShowNew(false) }}
        />,
        document.body,
      )}

      {confirm && createPortal(
        <CheckoutConfirmModal
          value={confirm.value}
          onCancel={() => { const cancel = confirm.cancel; setConfirm(null); cancel?.() }}
          onConfirm={() => { const run = confirm.run; setConfirm(null); run() }}
        />,
        document.body,
      )}
    </div>
  )
}
