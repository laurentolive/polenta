import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { ModificationControl } from './ModificationControl'

interface ViewHeaderProps {
  /** Optional leading back button — replaces the ad hoc back buttons each view used to define. */
  back?: { label?: string; onClick: () => void }
  title: ReactNode
  /** Secondary line under the title (e.g. branch name on the Version view). */
  subtitle?: ReactNode
  /** Per-view buttons/toolbars, rendered left of the Publier slot. */
  actions?: ReactNode
  /** Undefined ⇒ no project context (e.g. /account) ⇒ Publier slot omitted entirely. */
  currentProjectId?: string | null
}

/** Shared title bar for every main view — see specs/T92.md / T92-design.md §1-§2.1. */
export function ViewHeader({ back, title, subtitle, actions, currentProjectId }: ViewHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-edge bg-surface">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors shrink-0"
        >
          <ArrowLeft size={14} />
          {back.label ?? t('layout.viewHeader.back')}
        </button>
      )}

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink truncate">{title}</div>
        {subtitle && <div className="text-xs text-ink-3 mt-0.5 truncate">{subtitle}</div>}
      </div>

      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}

      {currentProjectId !== undefined && <ModificationControl currentProjectId={currentProjectId} />}
    </div>
  )
}
