import type { ReactNode } from 'react'
import { User, FolderOpen, Search, GitBranch, Layers, LayoutDashboard } from 'lucide-react'
import type { Panel } from './AppLayout'

interface Props {
  activePanel: Panel
  onSelect: (p: Panel) => void
  hasProject: boolean
}

const PANELS: {
  id: Panel
  icon: ReactNode
  label: string
  requiresProject?: boolean
}[] = [
  { id: 'account', icon: <User size={20} />,      label: 'Compte' },
  { id: 'project', icon: <FolderOpen size={20} />, label: 'Projet' },
  { id: 'dashboard', icon: <LayoutDashboard size={20} />, label: 'Suivi', requiresProject: true },
  { id: 'system',   icon: <Layers size={20} />,     label: 'Système', requiresProject: true },
  { id: 'search',  icon: <Search size={20} />,     label: 'Recherche', requiresProject: true },
  { id: 'version', icon: <GitBranch size={20} />,  label: 'Version',   requiresProject: true },
]

export function ActivityBar({ activePanel, onSelect, hasProject }: Props) {
  return (
    <div className="flex flex-col w-12 bg-slate-900 border-r border-slate-800 py-2 gap-1">
      {PANELS.map(p => {
        const disabled = !!p.requiresProject && !hasProject
        return (
          <button
            key={p.id}
            title={p.label}
            disabled={disabled}
            onClick={() => !disabled && onSelect(p.id)}
            className={[
              'flex items-center justify-center w-12 h-12 transition-colors',
              activePanel === p.id
                ? 'text-white bg-slate-700'
                : disabled
                  ? 'text-slate-600 cursor-default'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700',
            ].join(' ')}
          >
            {p.icon}
          </button>
        )
      })}
    </div>
  )
}
