import { Outlet, useRouterState, useNavigate } from '@tanstack/react-router'
import { useState, useRef, useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { ActivityBar } from './ActivityBar'
import { Sidebar } from './Sidebar'
import { SystemViewProvider } from '../../contexts/SystemViewContext'
import { VersioningProvider } from '../../contexts/VersioningContext'
import { SelectedRepoProvider } from '../../contexts/SelectedRepoContext'
import { CompareRefsProvider } from '../../contexts/CompareRefsContext'
import { ImpactAnalysisProvider } from '../../contexts/ImpactAnalysisContext'

export type Panel = 'account' | 'project' | 'search' | 'version' | 'system' | 'dashboard'

const SIDEBAR_ONLY_PANELS: Panel[] = ['account']

const SIDEBAR_WIDTH_KEY = 'polenta.sidebarWidth'
const SIDEBAR_WIDTH_DEFAULT = 260
const SIDEBAR_WIDTH_MIN = 160
const SIDEBAR_WIDTH_MAX = 500

/** Shared with TabsContext.tsx so both derive "current project" from the exact same rule. */
export function deriveCurrentProjectId(search: string): string | null {
  return new URLSearchParams(search ?? '').get('projectId')
}

export function deducePanel(pathname: string): Panel {
  if (pathname === '/search') return 'search'

  if (pathname === '/product' || pathname === '/components') return 'system'

  if (pathname === '/query' || pathname === '/dashboard') return 'dashboard'

  if (
    pathname.startsWith('/req/') ||
    pathname.startsWith('/test/') ||
    pathname.startsWith('/campaign/')
  ) {
    return 'system'
  }

  if (
    pathname === '/graph' ||
    pathname === '/diff' ||
    pathname === '/version-diff' ||
    pathname === '/versioning' ||
    pathname === '/baseline' ||
    pathname === '/impact-analysis'
  ) {
    return 'version'
  }

  return 'project'
}

export function AppLayout() {
  const navigate = useNavigate()
  const { pathname, search } = useRouterState({
    select: s => ({ pathname: s.location.pathname, search: s.location.searchStr })
  })

  const searchParams = new URLSearchParams(search ?? '')
  const repoPathFromSearch = searchParams.get('repoPath') ?? ''
  const currentProjectId = deriveCurrentProjectId(search)

  // Sidebar-only panels (account, search) have no dedicated route — track separately
  const [sidebarOverride, setSidebarOverride] = useState<Panel | null>(null)

  const routePanel = deducePanel(pathname)
  const activePanel: Panel = sidebarOverride ?? routePanel

  // Remembers which sub-view of the "version" panel (graph/baseline/version-diff/
  // impact-analysis) was last open, so switching to another activity-bar panel and back
  // restores it instead of always resetting to the graph — see handleSelectPanel below.
  const [lastVersionRoute, setLastVersionRoute] = useState<{ pathname: string; search: string } | null>(null)

  useEffect(() => {
    if (routePanel === 'version') {
      setLastVersionRoute({ pathname, search: search ?? '' })
    }
  }, [routePanel, pathname, search])

  // T109: même mécanisme pour le panneau "Suivi" (dashboard/query) — sans ça, cliquer sur
  // Suivi retombait toujours sur /query, quel que soit ce qui était affiché avant (un
  // dashboard bien chargé, cf. retour utilisateur), au lieu de restaurer la sous-vue quittée.
  const [lastDashboardRoute, setLastDashboardRoute] = useState<{ pathname: string; search: string } | null>(null)

  useEffect(() => {
    if (routePanel === 'dashboard') {
      setLastDashboardRoute({ pathname, search: search ?? '' })
    }
  }, [routePanel, pathname, search])

  useEffect(() => {
    setLastVersionRoute(null)
    setLastDashboardRoute(null)
  }, [currentProjectId])

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    const parsed = stored ? parseInt(stored, 10) : NaN
    return isNaN(parsed) ? SIDEBAR_WIDTH_DEFAULT : Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, parsed))
  })

  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleDragMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: sidebarWidth }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const dx = ev.clientX - dragState.current.startX
      const newWidth = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, dragState.current.startWidth + dx))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      dragState.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  function handleSelectPanel(p: Panel) {
    if (SIDEBAR_ONLY_PANELS.includes(p)) {
      setSidebarOverride(prev => prev === p ? null : p)
      return
    }
    setSidebarOverride(null)

    switch (p) {
      case 'project':
        if (currentProjectId) {
          navigate({ to: '/schema', search: { repoPath: '', projectId: currentProjectId } })
        } else {
          navigate({ to: '/' })
        }
        break
      case 'version':
        if (currentProjectId) {
          const params = new URLSearchParams(lastVersionRoute?.search ?? '')
          switch (lastVersionRoute?.pathname) {
            case '/baseline':
              navigate({ to: '/baseline', search: { projectId: currentProjectId } })
              break
            case '/impact-analysis':
              navigate({ to: '/impact-analysis', search: { projectId: currentProjectId } })
              break
            case '/version-diff':
              navigate({
                to: '/version-diff',
                search: {
                  projectId: currentProjectId,
                  repoPath: params.get('repoPath') ?? '',
                  ref1: params.get('ref1') ?? undefined,
                  sha1: params.get('sha1') ?? undefined,
                  ref2: params.get('ref2') ?? undefined,
                  sha2: params.get('sha2') ?? undefined,
                },
              })
              break
            case '/graph':
            default:
              navigate({ to: '/graph', search: { projectId: currentProjectId, sha: params.get('sha') ?? undefined } })
          }
        }
        break
      case 'system':
        navigate({ to: '/product', search: { projectId: currentProjectId ?? '', tab: undefined, repo: undefined, node: undefined, type: undefined } })
        break
      case 'dashboard':
        if (currentProjectId) {
          const params = new URLSearchParams(lastDashboardRoute?.search ?? '')
          if (lastDashboardRoute?.pathname === '/query') {
            navigate({ to: '/query', search: { projectId: currentProjectId, queryId: params.get('queryId') ?? undefined } })
          } else {
            // Défaut, et cas `/dashboard` : redirige vers le dernier dashboard consulté si
            // connu, sinon vers le premier de la liste (T109) — jamais un simple retour à
            // la vue Requêtes vide.
            navigate({ to: '/dashboard', search: { projectId: currentProjectId, dashboardId: params.get('dashboardId') ?? undefined } })
          }
        }
        break
      case 'search':
        if (currentProjectId) {
          navigate({ to: '/search', search: { projectId: currentProjectId } })
        }
        break
    }
  }

  const inner = (
    <div className="flex h-full overflow-hidden bg-canvas">
      <ActivityBar activePanel={activePanel} onSelect={handleSelectPanel} hasProject={!!currentProjectId} />
      <Sidebar activePanel={activePanel} currentProjectId={currentProjectId} width={sidebarWidth} />
      <div
        className="bg-edge hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors"
        style={{ width: 4 }}
        onMouseDown={handleDragMouseDown}
      />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )

  // VersioningProvider is mounted whenever a project is open so that VersioningContext
  // (branch name, isReadonly) is available to all routes — including SystemView.
  // SelectedRepoProvider and SystemViewProvider are nested inside so they can consume
  // useVersioning(). `key={currentProjectId}` on SelectedRepoProvider forces a remount
  // (fresh selection state, back to the new root) on project switch instead of an
  // internal reset effect.
  //
  // SystemViewProvider is mounted unconditionally (not just while routePanel === 'system')
  // even though it's only consumed by the Système views: wrapping `inner` in it only when
  // on that panel used to make `inner` change JSX type at that slot every time the user
  // entered/left Système, forcing React to unmount and remount the entire app shell
  // (ActivityBar, Sidebar, main/Outlet) — wiping any in-memory state living below AppLayout,
  // including which impact analysis was open and the Version panel's remembered sub-view.
  // SystemViewProvider's own effects already no-op outside /product and /components.
  if (!currentProjectId) return inner

  return (
    <VersioningProvider currentProjectId={currentProjectId}>
      <SelectedRepoProvider key={currentProjectId}>
        <CompareRefsProvider>
          <ImpactAnalysisProvider>
            <SystemViewProvider currentProjectId={currentProjectId}>
              {inner}
            </SystemViewProvider>
          </ImpactAnalysisProvider>
        </CompareRefsProvider>
      </SelectedRepoProvider>
    </VersioningProvider>
  )
}
