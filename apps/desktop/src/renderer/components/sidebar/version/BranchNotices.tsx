import { X } from 'lucide-react'

/** GH106 — refused branch create/delete (integration-branch guard) and designation notices from
 *  `useBranchCheckout`, shared by `VersionRepoFolder` and the Structure tab's `RepoBranchSelector`. */
export function BranchNotices({ notices, onDismiss }: { notices: string[]; onDismiss: () => void }) {
  if (notices.length === 0) return null
  return (
    <p className="mt-1.5 flex items-start gap-2 text-xs text-status-warning leading-snug">
      <span className="flex-1 flex flex-col">{notices.map(n => <span key={n}>{n}</span>)}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 hover:opacity-70">
        <X size={11} />
      </button>
    </p>
  )
}
