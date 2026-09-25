import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { User, FolderOpen, Search, GitBranch, ClipboardList, FlaskConical, Rocket, PieChart, Variable } from 'lucide-react'
import type { Panel } from './AppLayout'

interface Props {
  activePanel: Panel
  onSelect: (p: Panel) => void
  hasProject: boolean
}

const PANELS: {
  id: Panel
  icon: ReactNode
  labelKey: string
  requiresProject?: boolean
}[] = [
  { id: 'account', icon: <User size={20} />,      labelKey: 'layout.activityBar.account' },
  { id: 'project', icon: <FolderOpen size={20} />, labelKey: 'layout.activityBar.project' },
  { id: 'dashboard', icon: <PieChart size={20} />, labelKey: 'layout.activityBar.dashboard', requiresProject: true },
  { id: 'requirements', icon: <ClipboardList size={20} />, labelKey: 'layout.activityBar.requirements', requiresProject: true },
  { id: 'tests',        icon: <FlaskConical size={20} />,  labelKey: 'layout.activityBar.tests',        requiresProject: true },
  { id: 'campaigns',    icon: <Rocket size={20} />,         labelKey: 'layout.activityBar.campaigns',    requiresProject: true },
  { id: 'parameters',   icon: <Variable size={20} />,       labelKey: 'layout.activityBar.parameters',   requiresProject: true },
  { id: 'search',  icon: <Search size={20} />,     labelKey: 'layout.activityBar.search', requiresProject: true },
  { id: 'version', icon: <GitBranch size={20} />,  labelKey: 'layout.activityBar.version',   requiresProject: true },
]

export function ActivityBar({ activePanel, onSelect, hasProject }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col w-12 bg-activity-bg border-r border-activity-border py-2 gap-1">
      {PANELS.map(p => {
        const disabled = !!p.requiresProject && !hasProject
        return (
          <button
            key={p.id}
            title={t(p.labelKey)}
            disabled={disabled}
            onClick={() => !disabled && onSelect(p.id)}
            className={[
              'flex items-center justify-center w-12 h-12 transition-colors',
              activePanel === p.id
                ? 'text-activity-fg-hover bg-activity-bg-active'
                : disabled
                  ? 'text-activity-fg-disabled cursor-default'
                  : 'text-activity-fg hover:text-activity-fg-hover hover:bg-activity-bg-active',
            ].join(' ')}
          >
            {p.icon}
          </button>
        )
      })}
    </div>
  )
}
