import { Outlet, useRouterState, useNavigate } from '@tanstack/react-router'
import { useState, useRef, useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { ActivityBar } from './ActivityBar'
import { Sidebar } from './Sidebar'
import { SystemViewProvider } from '../../contexts/SystemViewContext'
import { SearchProvider } from '../../contexts/SearchContext'
import { VersioningProvider } from '../../contexts/VersioningContext'
import { SelectedRepoProvider } from '../../contexts/SelectedRepoContext'
import { CompareRefsProvider } from '../../contexts/CompareRefsContext'
import { ApprovalGateProvider } from '../../contexts/ApprovalGateContext'
import { useAutoPull } from '../../hooks/useAutoPull'
import { ForgeAccessBanner } from './ForgeAccessBanner'
import { RepoAccessBanner } from './RepoAccessBanner'
import { JobBanner } from '../admin/JobBanner'
import { capabilities } from '../../platform'
import { isSidebarToggleShortcut, loadSidebarCollapsed, saveSidebarCollapsed } from './sidebarCollapse'

export type Panel = 'account' | 'project' | 'search' | 'version' | 'requirements' | 'tests' | 'campaigns' | 'changesets' | 'dashboard' | 'parameters'

const SIDEBAR_ONLY_PANELS: Panel[] = ['account']

const SIDEBAR_WIDTH_KEY = 'polenta.sidebarWidth'
const SIDEBAR_WIDTH_DEFAULT = 260
const SIDEBAR_WIDTH_MIN = 160
const SIDEBAR_WIDTH_MAX = 500

/** Shared with TabsContext.tsx so both derive "current project" from the exact same rule. */
export function deriveCurrentProjectId(search: string): string | null {
  return new URLSearchParams(search ?? '').get('projectId')
}

/** category (from the `category` search param of /product and /components) tells requirements
 *  apart from tests/campaigns — those two routes host all three, split only by that param. Doc
 *  routes (/req/, /test/, /campaign/) already know their own kind from the path, no param needed. */
export function deducePanel(pathname: string, category?: string): Panel {
  if (pathname === '/search') return 'search'

  if (pathname === '/product' || pathname === '/components') {
    if (category === 'test') return 'tests'
    if (category === 'campaign') return 'campaigns'
    return 'requirements'
  }

  if (pathname === '/query' || pathname === '/dashboard') return 'dashboard'
  if (pathname === '/parameters') return 'parameters'
  // GH199 — la vue Analyse d'impact est intégrée à la vue Changements (modifications locales,
  // « Impact à vérifier », Constellation).
  if (pathname === '/changesets' || pathname.startsWith('/changesets/') || pathname.startsWith('/changeset/') || pathname === '/constellation') return 'changesets'

  if (pathname.startsWith('/req/')) return 'requirements'
  if (pathname.startsWith('/test/')) return 'tests'
  if (pathname.startsWith('/campaign/')) return 'campaigns'

  if (
    pathname === '/graph' ||
    pathname === '/diff' ||
    pathname === '/version-diff' ||
    pathname === '/versioning' ||
    pathname === '/baseline'
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

  // T155: runs for as long as a project is open, independently of which panel is active — a
  // non-git-initiated user should never have to open the Version panel to stay up to date.
  // No-ops internally while `currentProjectId` is null. Called here rather than from inside
  // `VersioningProvider` below purely so it's unconditional, next to the other top-level hooks,
  // ahead of this component's early `if (!currentProjectId) return inner` (rules of hooks).
  useAutoPull(currentProjectId)

  // Sidebar-only panels (account, search) have no dedicated route — track separately
  const [sidebarOverride, setSidebarOverride] = useState<Panel | null>(null)

  const routePanel = deducePanel(pathname, searchParams.get('category') ?? undefined)
  const activePanel: Panel = sidebarOverride ?? routePanel

  // Remembers which sub-view of the "version" panel (graph/baseline/version-diff) was
  // last open, so switching to another activity-bar panel and back
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

  // GH123: sidebar collapsed/expanded, VS Code style — re-clicking the active activity-bar icon or
  // Ctrl+B toggles it. Per-machine preference, like the width above.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadSidebarCollapsed)

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    // Bubble phase on window: a richtext editor (Ctrl+B = bold) has already handled the key, and
    // isSidebarToggleShortcut skips editable targets anyway.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSidebarToggleShortcut(e)) return
      e.preventDefault() // web client: Firefox opens its bookmarks sidebar on Ctrl+B
      setSidebarCollapsed(c => !c)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleSelectPanel(p: Panel) {
    // GH123: the active icon no longer re-navigates to the panel's default route, it only
    // collapses/expands the sidebar. Collapsing Account also drops the override, so the next
    // expand shows the route's panel.
    if (p === activePanel) {
      if (!sidebarCollapsed) setSidebarOverride(null)
      setSidebarCollapsed(!sidebarCollapsed)
      return
    }
    setSidebarCollapsed(false)

    if (SIDEBAR_ONLY_PANELS.includes(p)) {
      setSidebarOverride(p)
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
      case 'requirements':
      case 'tests':
      case 'campaigns': {
        const category = p === 'requirements' ? 'requirement' : p === 'tests' ? 'test' : 'campaign'
        // Carries the current `repo` forward instead of clearing it (as the old single "Système"
        // entry always did): with three tabs now sharing this reset, clearing repo on every click
        // sends SystemViewContext down its `!urlRepo` branch each time — which waits on every
        // workspace repo's schema (`allSchemasLoaded`) before it can even pick a default node/type.
        // Cheap for a mono-repo project, but on a workspace with several submodule dependencies
        // that's real git/disk I/O on the main process, repeated on every tab switch — the
        // multi-second freeze reported after this change. Only node/type are tab-specific and need
        // clearing; the selected component stays valid across Exigences/Tests/Campagnes.
        navigate({ to: '/product', search: { projectId: currentProjectId ?? '', tab: undefined, repo: searchParams.get('repo') ?? undefined, node: undefined, type: undefined, category } })
        break
      }
      case 'parameters':
        if (currentProjectId) navigate({ to: '/parameters', search: { projectId: currentProjectId, repo: undefined } })
        break
      case 'changesets':
        // GH198 — vue Changements : page d'accueil (le panneau liste les changes du workspace).
        if (currentProjectId) navigate({ to: '/changesets', search: { projectId: currentProjectId } })
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
      <ActivityBar activePanel={activePanel} onSelect={handleSelectPanel} hasProject={!!currentProjectId} sidebarCollapsed={sidebarCollapsed} />
      <Sidebar activePanel={activePanel} currentProjectId={currentProjectId} width={sidebarWidth} collapsed={sidebarCollapsed} />
      {!sidebarCollapsed && (
        <div
          className="bg-edge hover:bg-status-info-solid cursor-col-resize shrink-0 transition-colors"
          style={{ width: 4 }}
          onMouseDown={handleDragMouseDown}
        />
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ForgeAccessBanner />
        {capabilities.serverAdmin && <JobBanner />}
        {currentProjectId && <RepoAccessBanner projectId={currentProjectId} />}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
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
  // including the Version panel's remembered sub-view.
  // SystemViewProvider's own effects already no-op outside /product and /components.
  if (!currentProjectId) return inner

  return (
    <VersioningProvider currentProjectId={currentProjectId}>
      <SelectedRepoProvider key={currentProjectId}>
        <CompareRefsProvider>
            <SystemViewProvider currentProjectId={currentProjectId}>
              <SearchProvider key={currentProjectId} currentProjectId={currentProjectId}>
                <ApprovalGateProvider>
                  {inner}
                </ApprovalGateProvider>
              </SearchProvider>
            </SystemViewProvider>
        </CompareRefsProvider>
      </SelectedRepoProvider>
    </VersioningProvider>
  )
}
