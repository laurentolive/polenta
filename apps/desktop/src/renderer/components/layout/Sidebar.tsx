import type { Panel } from './AppLayout'
import { AccountPanel } from '../sidebar/AccountPanel'
import { ProjectPanel } from '../sidebar/ProjectPanel'
import { SearchPanel } from '../sidebar/SearchPanel'
import { VersionPanel } from '../sidebar/VersionPanel'
import { ImpactPanel } from '../sidebar/ImpactPanel'
import { SystemPanel } from '../sidebar/SystemPanel'
import { DashboardPanel } from '../sidebar/DashboardPanel'
import { ParametersPanel } from '../sidebar/ParametersPanel'
import { ChangesPanel } from '../sidebar/ChangesPanel'

interface Props {
  activePanel: Panel
  currentProjectId: string | null
  width: number
  /** GH123: hidden with CSS rather than unmounted, so panels keep their local state
   *  (commit message being typed, expanded folders, scroll). */
  collapsed?: boolean
}

export function Sidebar({ activePanel, currentProjectId, width, collapsed }: Props) {
  return (
    <div
      data-testid="sidebar"
      className={`bg-surface border-r border-edge flex flex-col overflow-hidden shrink-0${collapsed ? ' hidden' : ''}`}
      style={{ width }}
    >
      {activePanel === 'account' && <AccountPanel />}
      {activePanel === 'project' && <ProjectPanel currentProjectId={currentProjectId} />}
      {activePanel === 'search'  && currentProjectId && (
        <SearchPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'version' && currentProjectId && (
        <VersionPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'impact' && currentProjectId && <ImpactPanel projectId={currentProjectId} />}
      {(activePanel === 'requirements' || activePanel === 'tests' || activePanel === 'campaigns') && currentProjectId && (
        <SystemPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'dashboard' && currentProjectId && (
        <DashboardPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'parameters' && currentProjectId && <ParametersPanel projectId={currentProjectId} />}
      {activePanel === 'changes' && currentProjectId && <ChangesPanel projectId={currentProjectId} />}
    </div>
  )
}
