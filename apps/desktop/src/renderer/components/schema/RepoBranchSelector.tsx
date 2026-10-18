import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBranchCheckout } from '../../hooks/useBranchCheckout'
import { CheckoutConfirmModal } from './CheckoutConfirmModal'
import { BranchCombobox } from '../sidebar/version/BranchCombobox'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'
import { BranchNotices } from '../sidebar/version/BranchNotices'
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
  const { t } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const {
    currentBranch, allBranches, allTags, isDirty,
    checkout, checkoutCommit, createBranch, deleteBranch, isPending,
    pinWarning, dismissPinWarning, branchNotices, dismissBranchNotices,
  } = useBranchCheckout(node, workspaceDir, flatNodes, dropdownOpen)

  const [checkoutConfirm, setCheckoutConfirm] = useState<{ value: string; isCommit: boolean } | null>(null)

  if (!currentBranch) return null

  if (currentBranch.startsWith('dev-')) {
    return (
      <code
        className="text-xs text-ink-3 font-mono shrink-0"
        title={t('sidebar.version.modificationInProgress')}
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
      <BranchNotices notices={branchNotices} onDismiss={dismissBranchNotices} />

      {checkoutConfirm && (
        <CheckoutConfirmModal
          value={checkoutConfirm.value}
          onCancel={() => setCheckoutConfirm(null)}
          onConfirm={confirmCheckout}
          disabled={isPending}
        />
      )}
    </div>
  )
}
