import { useTranslation } from 'react-i18next'
import { VersionImpactSelector } from './version/VersionImpactSelector'

interface Props {
  projectId: string
}

// ── ImpactPanel ────────────────────────────────────────────────────────────────
// T174: the impact analysis has its own activity-bar entry (it used to be a sub-view of
// the Version panel) — baseline pair selection + saved analyses list.

export function ImpactPanel({ projectId }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t('layout.activityBar.impact')}</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <VersionImpactSelector projectId={projectId} />
      </div>
    </div>
  )
}
