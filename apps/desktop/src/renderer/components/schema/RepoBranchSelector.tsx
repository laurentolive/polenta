import { useState } from 'react'
import { useBranchCheckout } from '../../hooks/useBranchCheckout'
import { BranchCombobox } from '../sidebar/version/BranchCombobox'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'
import type { WorkspaceTreeNode } from '@polenta/types'

/** Compact inline branch checkout/create, shown to the right of every repo name in the Structure
 *  tree (T86) — a shortcut onto the same pin data the "Modifier" dependency modal edits, using the
 *  same mechanics (including checkout-by-commit and pin propagation, T82) as the Version panel's
 *  `VersionRepoFolder` (`useBranchCheckout`).
 *
 *  On a `dev-*` branch (in-progress modification, T83's simplified workflow), no checkout/create
 *  is offered here — only the branch name, read-only. Switching branches mid-modification goes
 *  through "Publier"/"Annuler", never through this selector. This restriction is specific to the
 *  Structure tree: the Version panel's `BranchCombobox` stays the unrestricted "advanced" tool. */
export function RepoBranchSelector({
  node, workspaceDir, flatNodes,
}: {
  node: { repoPath: string; name: string; url: string }
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
}) {
  // The selector sits on the row's always-visible header line (not gated by the row's own
  // expand/collapse state) — so branches/tags are only fetched once the dropdown is actually
  // opened, instead of polling every row in the tree continuously from the moment it mounts.
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const {
    currentBranch, allBranches, allTags, isDirty,
    checkout, checkoutCommit, createBranch, deleteBranch, isPending,
    pinWarning, dismissPinWarning,
  } = useBranchCheckout(node, workspaceDir, flatNodes, dropdownOpen)

  const [checkoutConfirm, setCheckoutConfirm] = useState<{ value: string; isCommit: boolean } | null>(null)

  if (!currentBranch) return null

  if (currentBranch.startsWith('dev-')) {
    return (
      <code
        className="text-xs text-ink-3 font-mono shrink-0"
        title="Modification en cours — changez de branche via « Publier » ou « Annuler »"
      >
        {currentBranch}
      </code>
    )
  }

  function handleCheckout(name: string) {
    if (isDirty) { setCheckoutConfirm({ value: name, isCommit: false }); return }
    checkout(name)
  }

  function handleCheckoutCommit(sha: string) {
    if (isDirty) { setCheckoutConfirm({ value: sha, isCommit: true }); return }
    checkoutCommit(sha)
  }

  function confirmCheckout() {
    if (!checkoutConfirm) return
    if (checkoutConfirm.isCommit) checkoutCommit(checkoutConfirm.value)
    else checkout(checkoutConfirm.value)
    setCheckoutConfirm(null)
  }

  return (
    <div className="w-36 shrink-0" onClick={e => e.stopPropagation()}>
      <BranchCombobox
        branches={allBranches}
        tags={allTags}
        currentBranch={currentBranch}
        onCheckout={handleCheckout}
        onCheckoutCommit={handleCheckoutCommit}
        onDelete={deleteBranch}
        onCreateNew={createBranch}
        isPending={isPending}
        onOpenChange={setDropdownOpen}
      />

      <PinPropagationWarning outcome={pinWarning} onDismiss={dismissPinWarning} />

      {checkoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-20" onClick={e => e.stopPropagation()}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-5 w-full max-w-sm mx-4">
            <h2 className="font-semibold text-sm text-ink mb-2">Changer de branche / tag ?</h2>
            <p className="text-xs text-ink-2 mb-4">
              Des fichiers sont modifiés ou stagés dans ce repo. Le checkout vers{' '}
              <span className="font-mono font-medium">{checkoutConfirm.value}</span> pourrait écraser ces
              changements. Committez d'abord pour ne rien perdre.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCheckoutConfirm(null)} className="btn-secondary text-xs">
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmCheckout}
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
              >
                Forcer le checkout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
