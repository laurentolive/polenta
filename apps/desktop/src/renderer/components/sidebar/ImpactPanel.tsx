import { useTranslation } from 'react-i18next'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { VersionImpactSelector } from './version/VersionImpactSelector'

interface Props {
  projectId: string
}

// ── ImpactPanel ────────────────────────────────────────────────────────────────
// T174: the impact analysis has its own activity-bar entry (it used to be a sub-view of
// the Version panel) — baseline pair selection + saved analyses list.
// GH183: also the entry point of the requirements constellation (traceability overview).

export function ImpactPanel({ projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const onConstellation = pathname === '/constellation'
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t('layout.activityBar.impact')}</p>
      </div>
      <button
        type="button"
        onClick={() => navigate({ to: '/constellation', search: { projectId } })}
        title={t('constellation.openFromPanelHint')}
        className={`flex items-center gap-2 px-4 py-2 text-xs text-left border-b border-edge shrink-0 hover:bg-surface-hover ${onConstellation ? 'bg-surface-hover text-ink font-medium' : 'text-ink-2'}`}
      >
        <Sparkles size={13} className="shrink-0" />
        {t('constellation.openFromPanel')}
      </button>
      <div className="flex-1 overflow-hidden">
        <VersionImpactSelector projectId={projectId} />
      </div>
    </div>
  )
}
