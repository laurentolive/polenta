import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { PinPropagationOutcome } from '../../../lib/workspaceActions'

interface Props {
  outcome: PinPropagationOutcome | null
  /** When set, renders a dismiss button and calls this instead of relying on the next
   *  propagation call to overwrite the outcome (T82 — used where the warning can otherwise
   *  linger after it's no longer relevant, e.g. ModificationControl across repo switches). */
  onDismiss?: () => void
}

/** Renders a warning distinct from a mutation's own error when propagating a pin update
 *  (T82) partially failed — conflicted entries were rolled back, failed ones errored.
 *  Shared between VersionRepoFolder (checkout/commit) and ModificationControl ("Publier"). */
export function PinPropagationWarning({ outcome, onDismiss }: Props) {
  const { t } = useTranslation()
  if (!outcome || (outcome.conflicted.length === 0 && outcome.failed.length === 0)) return null
  return (
    <p className="mt-1.5 flex items-start gap-2 text-xs text-status-warning leading-snug">
      <span className="flex-1">
        {outcome.conflicted.length > 0 &&
          t('sidebar.version.pinConflict', { names: outcome.conflicted.join(', ') })}
        {outcome.failed.map(f => t('sidebar.version.pinFailed', { name: f.name, error: f.error })).join(' ')}
      </span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 hover:opacity-70">
          <X size={11} />
        </button>
      )}
    </p>
  )
}
