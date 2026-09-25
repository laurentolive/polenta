import type { Panel } from './AppLayout'
import { AccountPanel } from '../sidebar/AccountPanel'
import { ProjectPanel } from '../sidebar/ProjectPanel'
import { SearchPanel } from '../sidebar/SearchPanel'
import { VersionPanel } from '../sidebar/VersionPanel'
import { SystemPanel } from '../sidebar/SystemPanel'
import { DashboardPanel } from '../sidebar/DashboardPanel'
import { ParametersPanel } from '../sidebar/ParametersPanel'

interface Props {
  activePanel: Panel
  currentProjectId: string | null
  width: number
}

export function Sidebar({ activePanel, currentProjectId, width }: Props) {
  return (
    <div className="bg-surface border-r border-edge flex flex-col overflow-hidden shrink-0" style={{ width }}>
      {activePanel === 'account' && <AccountPanel />}
      {activePanel === 'project' && <ProjectPanel currentProjectId={currentProjectId} />}
      {activePanel === 'search'  && currentProjectId && (
        <SearchPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'version' && currentProjectId && (
        <VersionPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {(activePanel === 'requirements' || activePanel === 'tests' || activePanel === 'campaigns') && currentProjectId && (
        <SystemPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'dashboard' && currentProjectId && (
        <DashboardPanel currentProjectId={currentProjectId} projectId={currentProjectId} />
      )}
      {activePanel === 'parameters' && currentProjectId && <ParametersPanel projectId={currentProjectId} />}
    </div>
  )
}
