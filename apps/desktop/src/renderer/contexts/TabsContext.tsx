import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { deducePanel, deriveCurrentProjectId, type Panel } from '../components/layout/AppLayout'

export interface Tab {
  id: string
  pathname: string
  searchParams: Record<string, string>
  title: string
}

interface TabsContextValue {
  tabs: Tab[]
  activeTabId: string
  recentlyClosed: Tab[]
  dirtyTabIds: Set<string>
  openTab: (pathname?: string, searchParams?: Record<string, string>) => void
  /** Closes unconditionally — no dirty guard. Used internally and by confirmCloseTab(). */
  closeTab: (id: string) => void
  /** Guarded entry point for the UI (tab croix, Ctrl+W) — flushes a focused field, then either
   *  closes immediately or opens the confirm-close popup if the tab is registered dirty. */
  attemptCloseTab: (id: string) => void
  activateTab: (id: string) => void
  reopenClosedTab: (id: string) => void
  pendingCloseId: string | null
  confirmCloseTab: () => void
  cancelCloseTab: () => void
  setTabDirty: (id: string, dirty: boolean) => void
  setTabTitleOverride: (id: string, title: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within a TabsProvider')
  return ctx
}

/** Registers whether the tab currently showing this view has unsaved changes — wire up with
 *  a view's own existing "isDirty"/"hasChanges" flag (see schema.tsx, req.$reqId.tsx). Ctrl+W /
 *  the tab's croix ask for confirmation instead of closing outright while this is true.
 *
 *  Reads `activeTabId` live from context rather than pinning it via a ref captured at mount:
 *  pinning was tried and reverted — the "+"/Ctrl+T new-tab action always targets the same home
 *  route (resolveHomeRoute), so a second tab opened while already on that route doesn't change
 *  the URL and never remounts the route component; a mount-time ref then stays wrongly pinned to
 *  the *first* tab that ever showed that URL for the rest of the session. Reading live avoids
 *  that entirely, at the cost of a narrower theoretical race during `activateTab`'s two-step
 *  `setActiveTabId` + `navigate()` — acceptable here since no route in this app uses a router
 *  `loader`, so `navigate()` has no async gap for a stray render to land in. `setTabDirty` must
 *  stay reference-stable (see its own comment) for this cleanup/re-run pattern not to loop. */
export function useRegisterTabDirty(dirty: boolean): void {
  const { activeTabId, setTabDirty } = useTabs()
  useEffect(() => {
    setTabDirty(activeTabId, dirty)
    return () => setTabDirty(activeTabId, false)
  }, [activeTabId, dirty, setTabDirty])
}

/** Refines the generic route-based default tab title (§2.3) once a view has loaded the real
 *  name of the entity it's displaying (e.g. "SYS-001 — Démarrage rapide" instead of "Exigence").
 *  Reads `activeTabId` live — see useRegisterTabDirty's comment for why, same reasoning applies.
 *  `null`/`undefined` means "not loaded yet" (skip); `''` is a legitimate saved empty title, not
 *  treated as "no title". */
export function useSetTabTitle(title: string | null | undefined): void {
  const { activeTabId, setTabTitleOverride } = useTabs()
  useEffect(() => {
    if (title === null || title === undefined) return
    setTabTitleOverride(activeTabId, title)
  }, [activeTabId, title, setTabTitleOverride])
}

function isEditableElement(el: Element): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

const RECENTLY_CLOSED_LIMIT = 10

function sameDestination(a: Tab, b: Tab): boolean {
  if (a.pathname !== b.pathname) return false
  const aKeys = Object.keys(a.searchParams)
  const bKeys = Object.keys(b.searchParams)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => a.searchParams[key] === b.searchParams[key])
}

/** Re-closing a destination already in the history moves it back to the front instead of
 *  creating a second entry — "Récemment fermés" lists distinct destinations, not close events. */
function pushRecentlyClosed(prev: Tab[], closed: Tab): Tab[] {
  return [closed, ...prev.filter(tab => !sameDestination(tab, closed))].slice(0, RECENTLY_CLOSED_LIMIT)
}

// Mirrors ActivityBar.tsx's PANELS labels — kept separate to avoid pulling the icon-bearing
// array (JSX) into this non-visual module just for its label strings. T111: stores i18n keys
// (reusing layout.activityBar.* so the two stay in sync by construction) rather than literal
// strings — `t()` isn't available at module scope, only inside TabsProvider.
const PANEL_LABEL_KEYS: Record<Panel, string> = {
  account: 'layout.activityBar.account',
  project: 'layout.activityBar.project',
  search: 'layout.activityBar.search',
  version: 'layout.activityBar.version',
  requirements: 'layout.activityBar.requirements',
  tests: 'layout.activityBar.tests',
  campaigns: 'layout.activityBar.campaigns',
  dashboard: 'layout.activityBar.dashboard',
}

// Exact-match overrides for routes whose default panel label (PANEL_LABEL_KEYS) would be too
// generic for a tab (e.g. every "system" panel route would otherwise show "Système"). Reuses
// existing keys from other namespaces where one already covers the same word (account,
// dashboard, version, preferences) instead of duplicating the string.
const TITLE_OVERRIDE_KEYS: Record<string, string> = {
  '/': 'layout.tabTitles.home',
  '/account': 'layout.activityBar.account',
  '/schema': 'layout.tabTitles.schema',
  '/graph': 'layout.tabTitles.graph',
  '/diff': 'layout.tabTitles.diff',
  '/baseline': 'layout.tabTitles.baseline',
  '/impact-analysis': 'layout.tabTitles.impactAnalysis',
  '/version-diff': 'layout.tabTitles.versionDiff',
  '/versioning': 'layout.activityBar.version',
  '/product': 'layout.tabTitles.product',
  '/components': 'layout.tabTitles.components',
  '/query': 'layout.tabTitles.query',
  '/dashboard': 'layout.activityBar.dashboard',
  '/preferences': 'preferences.title',
  '/compliance': 'layout.tabTitles.compliance',
  '/workspace': 'layout.tabTitles.workspace',
  '/req/new': 'layout.tabTitles.newRequirement',
  '/test/new': 'layout.tabTitles.newTest',
  '/campaign/new': 'layout.tabTitles.newCampaign',
}

const PREFIX_TITLE_KEYS: [prefix: string, key: string][] = [
  ['/req/', 'layout.tabTitles.requirement'],
  ['/test/', 'layout.tabTitles.test'],
  ['/campaign/', 'layout.tabTitles.campaign'],
]

/** Default tab title for a route — refined per-entity by useSetTabTitle in a later sprint. */
function defaultTitleForPathname(pathname: string, t: TFunction): string {
  if (TITLE_OVERRIDE_KEYS[pathname]) return t(TITLE_OVERRIDE_KEYS[pathname])
  const prefixMatch = PREFIX_TITLE_KEYS.find(([prefix]) => pathname.startsWith(prefix))
  if (prefixMatch) return t(prefixMatch[1])
  return t(PANEL_LABEL_KEYS[deducePanel(pathname)])
}

function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search ?? ''))
}

function makeTab(pathname: string, searchParams: Record<string, string>, t: TFunction): Tab {
  return {
    id: crypto.randomUUID(),
    pathname,
    searchParams,
    title: defaultTitleForPathname(pathname, t),
  }
}

/** Same landing route AppLayout's ActivityBar "Projet" click already navigates to
 *  (AppLayout.tsx handleSelectPanel, case 'project') — kept in sync with T102 once merged. */
function resolveHomeRoute(currentProjectId: string | null): { pathname: string; searchParams: Record<string, string> } {
  if (currentProjectId) {
    return { pathname: '/schema', searchParams: { repoPath: '', projectId: currentProjectId } }
  }
  return { pathname: '/', searchParams: {} }
}

interface Props {
  children: ReactNode
}

// Module-level, not React state — deliberately survives a remount of TabsProvider itself.
// TanStack Router remounts the whole root route component (RootLayout, and everything below
// it including TabsProvider) on some navigations in this app — pre-existing on master, e.g.
// reproducible there today by clicking "Comparer deux versions" in the Version panel, harmless
// before T101 only because nothing stateful lived in that subtree yet. Rehydrating tabs/
// activeTabId/recentlyClosed from here on mount (and keeping it current after every render)
// means that pre-existing remount no longer silently collapses every open tab to one. Not a fix
// for the remount itself (a separate, likely file://-protocol-related TanStack Router quirk,
// worth its own investigation) — just makes this feature resilient to it. `dirtyTabIds`/
// `pendingCloseId` are deliberately NOT cached: the route component that registered them
// genuinely unmounts too in this scenario, so whatever made a tab dirty is really gone by the
// time TabsProvider remounts — caching them would show a dirty dot for a draft that no longer
// exists anywhere in memory.
let sessionCache: { tabs: Tab[]; activeTabId: string; recentlyClosed: Tab[] } | null = null

export function TabsProvider({ children }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname, search } = useRouterState({
    select: s => ({ pathname: s.location.pathname, search: s.location.searchStr }),
  })

  // setTabTitleOverride must stay reference-stable (empty useCallback deps, see below) — this
  // ref lets it read the current `t` without going stale on a locale switch.
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  const [tabs, setTabs] = useState<Tab[]>(() => sessionCache?.tabs ?? [makeTab(pathname, parseSearch(search), t)])
  const [activeTabId, setActiveTabId] = useState<string>(() => sessionCache?.activeTabId ?? tabs[0].id)
  const [recentlyClosed, setRecentlyClosed] = useState<Tab[]>(() => sessionCache?.recentlyClosed ?? [])
  const [dirtyTabIds, setDirtyTabIds] = useState<Set<string>>(new Set())
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)

  useEffect(() => {
    sessionCache = { tabs, activeTabId, recentlyClosed }
  })

  const goTo = useCallback((tab: Tab) => {
    navigate({ to: tab.pathname as never, search: tab.searchParams as never })
  }, [navigate])

  // Keeps the active tab's stored URL in sync with normal in-app navigation (clicking a
  // requirement, changing a filter…) — this is what lets switching away and back restore the
  // exact position without every navigate() having to know about tabs.
  useEffect(() => {
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, pathname, searchParams: parseSearch(search), title: defaultTitleForPathname(pathname, t) }
        : tab
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, t])

  const currentProjectId = deriveCurrentProjectId(search)

  // Resets tabs to a single home tab on a genuine project switch/close — but NOT on every
  // transient dip to a projectId-less URL. Some routes (e.g. /workspace, a legacy-link
  // resolver that immediately re-navigates to /schema?projectId=…) never carry `projectId`
  // even while a project is very much still open; treating that as "project closed" would
  // silently wipe every open tab on the way through. "/" is the one unambiguous "no project"
  // landing route (see routes/index.tsx) — a real close/logout ends up there.
  const skipReset = useRef(true)
  const lastNonNullProjectId = useRef(currentProjectId)
  useEffect(() => {
    if (skipReset.current) {
      skipReset.current = false
      lastNonNullProjectId.current = currentProjectId
      return
    }

    // `lastNonNullProjectId.current !== null` excludes the very first "no project → project
    // opened" transition of a session: at that point only one, freshly-created tab exists and
    // the normal router-sync effect above already updates it in place — there's nothing to
    // reset away from. Treating it as a switch anyway used to create a brand-new tab id via
    // makeTab() while schema.tsx (already mounted, same /schema URL before and after so no
    // remount occurs) kept reporting dirty state under the old, now-discarded tab id via
    // useRegisterTabDirty — the dot/confirm-on-close would silently apply to no tab at all.
    const isRealSwitch = currentProjectId !== null && lastNonNullProjectId.current !== null && currentProjectId !== lastNonNullProjectId.current
    const isRealClose = currentProjectId === null && pathname === '/'

    if (isRealSwitch || isRealClose) {
      const home = resolveHomeRoute(currentProjectId)
      const tab = makeTab(home.pathname, home.searchParams, t)
      setTabs([tab])
      setActiveTabId(tab.id)
      setRecentlyClosed([])
    }

    if (currentProjectId !== null) lastNonNullProjectId.current = currentProjectId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, pathname, t])

  function openTab(pathname?: string, searchParams?: Record<string, string>) {
    const target = pathname ? { pathname, searchParams: searchParams ?? {} } : resolveHomeRoute(currentProjectId)
    const tab = makeTab(target.pathname, target.searchParams, t)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    goTo(tab)
  }

  function activateTab(id: string) {
    const tab = tabs.find(item => item.id === id)
    if (!tab) return
    setActiveTabId(id)
    goTo(tab)
  }

  function closeTab(id: string) {
    const index = tabs.findIndex(item => item.id === id)
    if (index === -1) return

    setDirtyTabIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    if (tabs.length === 1) {
      // Last tab: reset its content to the home route instead of removing it — a window is
      // never left with zero tabs. The original content is still recoverable afterwards via
      // "Récemment fermés", same as closing any other tab.
      const original = tabs[0]
      const home = resolveHomeRoute(currentProjectId)
      const tab: Tab = { id: original.id, pathname: home.pathname, searchParams: home.searchParams, title: defaultTitleForPathname(home.pathname, t) }
      setTabs([tab])
      setActiveTabId(tab.id)
      setRecentlyClosed(prev => pushRecentlyClosed(prev, original))
      goTo(tab)
      return
    }

    const closed = tabs[index]
    const remaining = tabs.filter(item => item.id !== id)
    setTabs(remaining)
    setRecentlyClosed(prev => pushRecentlyClosed(prev, closed))

    if (id === activeTabId) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)]
      setActiveTabId(neighbor.id)
      goTo(neighbor)
    }
  }

  /** See TabsContextValue.attemptCloseTab. */
  function attemptCloseTab(id: string) {
    if (id === activeTabId) {
      const active = document.activeElement
      // Flush whatever the focused field's own onBlur autosave does before deciding whether
      // this tab still counts as dirty — see T101-design.md §3.2. No-op for views that
      // register real dirty state via useRegisterTabDirty (blurring a field doesn't make an
      // unsaved structural draft any less unsaved).
      if (active && isEditableElement(active)) (active as HTMLElement).blur()
    }
    if (dirtyTabIds.has(id)) {
      setPendingCloseId(id)
      return
    }
    closeTab(id)
  }

  function confirmCloseTab() {
    if (pendingCloseId) closeTab(pendingCloseId)
    setPendingCloseId(null)
  }

  function cancelCloseTab() {
    setPendingCloseId(null)
  }

  // useCallback with empty deps (not just a plain function) is required here, not an
  // optimization: both are listed as effect dependencies in useRegisterTabDirty/useSetTabTitle.
  // If recreated every TabsProvider render, each state update they make (even a same-value one
  // that bails out to the same `prev` reference) still changes THEIR OWN identity, re-firing
  // those effects, which call them again — for setTabDirty specifically, the cleanup-then-rerun
  // pattern (false, then true again) each produces a genuinely new Set object even though the
  // net content is unchanged, so it never bails out to an Object.is-equal reference: an infinite
  // render loop that never settles, not merely a performance smell. Everything either setter
  // needs comes from its parameters or the functional updater's `prev` (always fresh) — nothing
  // from the render closure — so `[]` is safe, not just convenient.
  const setTabDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyTabIds(prev => {
      const has = prev.has(id)
      if (dirty === has) return prev
      const next = new Set(prev)
      if (dirty) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  const setTabTitleOverride = useCallback((id: string, title: string) => {
    setTabs(prev => {
      const tab = prev.find(item => item.id === id)
      if (!tab) return prev
      const nextTitle = title || defaultTitleForPathname(tab.pathname, tRef.current)
      if (tab.title === nextTitle) return prev
      return prev.map(item => item.id === id ? { ...item, title: nextTitle } : item)
    })
  }, [])

  function reopenClosedTab(id: string) {
    const closed = recentlyClosed.find(item => item.id === id)
    if (!closed) return
    setRecentlyClosed(prev => prev.filter(rc => rc.id !== id))
    const tab = makeTab(closed.pathname, closed.searchParams, t)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    goTo(tab)
  }

  return (
    <TabsContext.Provider value={{
      tabs, activeTabId, recentlyClosed, dirtyTabIds, openTab, closeTab, attemptCloseTab, activateTab, reopenClosedTab,
      pendingCloseId, confirmCloseTab, cancelCloseTab, setTabDirty, setTabTitleOverride,
    }}>
      {children}
    </TabsContext.Provider>
  )
}
