import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { deducePanel, deriveCurrentProjectId, type Panel } from '../components/layout/AppLayout'
import { recordLocation, sameDestination, type TabHistory } from '../lib/tabHistory'
import { getBootTab } from '../lib/bootTab'
import { captureActiveDraft, stageIncomingDraft } from '../lib/tabDraft'
import { api } from '../api'
import type { TabDragPayload } from '../../shared/tab-drag'

/** GH228 — `history[historyIndex]` est la page affichée ; `pathname`/`searchParams`/`title` en
 *  restent la copie courante (activation d'onglet, menu, « Récemment fermés »). */
export interface Tab extends TabHistory {
  id: string
  pathname: string
  searchParams: Record<string, string>
  title: string
}

/** GH405 — action qui quitte la page de l'onglet actif, en attente de confirmation si l'onglet
 *  est dirty (une seule popup, « Quitter cette page ? », pour toutes). */
export type LeaveAction =
  | { kind: 'history'; index: number }
  | { kind: 'activate'; id: string }
  | { kind: 'open'; pathname?: string; searchParams?: Record<string, string> }
  | { kind: 'reopen'; id: string }

interface TabsContextValue {
  tabs: Tab[]
  activeTabId: string
  recentlyClosed: Tab[]
  dirtyTabIds: Set<string>
  /** Closes unconditionally — no dirty guard. Used internally and by confirmCloseTab(). */
  closeTab: (id: string) => void
  /** Guarded entry point for the UI (tab croix, Ctrl+W) — flushes a focused field, then either
   *  closes immediately or opens the confirm-close popup if the tab is registered dirty. */
  attemptCloseTab: (id: string) => void
  /** GH405 / GH407 — seuls points d'entrée qui changent d'onglet (clic sur un onglet, menu ▾, `+` /
   *  Ctrl+T, « Récemment fermés », Ctrl+Tab, Ctrl+clic sur un lien d'élément, ouvertures
   *  programmatiques) : quittent le champ actif puis agissent, ou ouvrent « Quitter cette page ? »
   *  si l'onglet actif est dirty. `openTab` / `activateTab` / `reopenClosedTab`, non gardés, restent
   *  internes (GH407 : un appel direct démontait la page modifiée et perdait sa saisie). Après un
   *  `await`, appeler `attemptOpenTab` sous `flushSync` (GH37, voir `openTab`). */
  attemptActivateTab: (id: string) => void
  attemptOpenTab: (pathname?: string, searchParams?: Record<string, string>) => void
  attemptReopenClosedTab: (id: string) => void
  pendingCloseId: string | null
  confirmCloseTab: () => void
  cancelCloseTab: () => void
  setTabDirty: (id: string, dirty: boolean) => void
  setTabTitleOverride: (id: string, title: string) => void
  /** GH228 — onglet actif (historique Précédent / Suivant). */
  activeTab: Tab
  /** GH228 — point d'entrée de l'UI pour aller à l'entrée `index` de l'historique de l'onglet
   *  actif : quitte le champ actif puis navigue, ou ouvre la popup si l'onglet est dirty. */
  attemptHistoryNav: (index: number) => void
  /** GH405 — départ en attente de confirmation (`ConfirmLeavePageModal`), `null` sinon. */
  pendingLeave: LeaveAction | null
  confirmLeave: () => void
  cancelLeave: () => void
  /** GH343 — réordonne : l'onglet `id` va à la position `toIndex` (emplacement avant le glisser, 0…n). */
  moveTab: (id: string, toIndex: number) => void
  /** GH343 — onglet parti dans une autre fenêtre : retiré sans garde ni « Récemment fermés » ; dernier
   *  onglet → la fenêtre se ferme. */
  detachTab: (id: string) => void
  /** GH343 — onglet reçu d'une autre fenêtre (historique et saisie `draft` compris), inséré à `index`
   *  et activé ; une fenêtre sans projet (accueil) le prend à la place de ses onglets. GH407 — page
   *  active modifiée : inséré sans être activé, « Quitter cette page ? » décide de son activation ;
   *  sa saisie attend son activation. */
  adoptTab: (tab: TabDragPayload['tab'], index?: number, draft?: TabDragPayload['draft']) => void
  /** GH343 — contenu transporté d'un onglet glissé (saisie de la page affichée comprise). */
  snapshotTab: (id: string) => Pick<TabDragPayload, 'tab' | 'draft'> | null
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within a TabsProvider')
  return ctx
}

/** GH65 — même contexte, `null` hors `TabsProvider` (routes « nues » : impression, export PDF). */
export function useOptionalTabs(): TabsContextValue | null {
  return useContext(TabsContext)
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
  const { activeTabId, activeTab, setTabTitleOverride } = useTabs()
  // GH228 — re-applied when a navigation resets the tab to its route default title (every URL
  // change does), even if `title` itself didn't change (word → excel on the same element).
  const currentTitle = activeTab.title
  useEffect(() => {
    if (title === null || title === undefined) return
    setTabTitleOverride(activeTabId, title)
  }, [activeTabId, title, currentTitle, setTabTitleOverride])
}

function isEditableElement(el: Element): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

const RECENTLY_CLOSED_LIMIT = 10

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
  // GH233 — panneau de la résolution de conflits (pas d'icône dans la barre d'activité).
  merge: 'mergeResolve.files',
  project: 'layout.activityBar.project',
  search: 'layout.activityBar.search',
  version: 'layout.activityBar.version',
  requirements: 'layout.activityBar.requirements',
  tests: 'layout.activityBar.tests',
  campaigns: 'layout.activityBar.campaigns',
  issues: 'layout.activityBar.issues',
  validation: 'layout.activityBar.validation',
  dashboard: 'layout.activityBar.dashboard',
  parameters: 'layout.activityBar.parameters',
}

// Exact-match overrides for routes whose default panel label (PANEL_LABEL_KEYS) would be too
// generic for a tab (e.g. every "system" panel route would otherwise show "Système"). Reuses
// existing keys from other namespaces where one already covers the same word (account,
// dashboard, version, preferences) instead of duplicating the string.
const TITLE_OVERRIDE_KEYS: Record<string, string> = {
  '/': 'layout.tabTitles.home',
  '/account': 'layout.activityBar.account',
  '/admin': 'admin.title',
  '/schema': 'layout.tabTitles.schema',
  '/graph': 'layout.tabTitles.graph',
  '/diff': 'layout.tabTitles.diff',
  '/baseline': 'layout.tabTitles.baseline',
  '/local-impact': 'impactAnalysisPage.localTitle',
  '/revalidation': 'impactAnalysisPage.revalidation.listTitle',
  '/version-diff': 'layout.tabTitles.versionDiff',
  '/merge-resolve': 'layout.tabTitles.mergeResolve',
  '/versioning': 'layout.activityBar.version',
  '/product': 'layout.tabTitles.product',
  '/components': 'layout.tabTitles.components',
  '/query': 'layout.tabTitles.query',
  '/dashboard': 'layout.activityBar.dashboard',
  '/preferences': 'preferences.title',
  '/compliance': 'layout.tabTitles.compliance',
  '/constellation': 'layout.tabTitles.constellation',
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
  const title = defaultTitleForPathname(pathname, t)
  return {
    id: crypto.randomUUID(),
    pathname,
    searchParams,
    title,
    history: [{ pathname, searchParams, title }],
    historyIndex: 0,
  }
}

/** GH228 — marque une navigation faite par `TabsProvider` lui-même (activation d'onglet,
 *  Précédent / Suivant…) : elle ne crée pas d'entrée dans l'historique de l'onglet. */
const TAB_NAV_STATE = { polentaTabNav: true }

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
// GH228 — module-level for the same reason: the PUSH that remounts TabsProvider is seen by the
// outgoing provider's history subscriber and must still count for the remounted one.
let pendingPush = false

export function TabsProvider({ children }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const { pathname, search } = useRouterState({
    select: s => ({ pathname: s.location.pathname, search: s.location.searchStr }),
  })

  // setTabTitleOverride must stay reference-stable (empty useCallback deps, see below) — this
  // ref lets it read the current `t` without going stale on a locale switch.
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  // GH343 — fenêtre créée par un glisser : l'onglet reçu, avec son historique.
  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (sessionCache) return sessionCache.tabs
    const boot = getBootTab()
    return [boot ? { ...boot, id: crypto.randomUUID() } : makeTab(pathname, parseSearch(search), t)]
  })
  const [activeTabId, setActiveTabId] = useState<string>(() => sessionCache?.activeTabId ?? tabs[0].id)
  const [recentlyClosed, setRecentlyClosed] = useState<Tab[]>(() => sessionCache?.recentlyClosed ?? [])
  const [dirtyTabIds, setDirtyTabIds] = useState<Set<string>>(new Set())
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const [pendingLeave, setPendingLeave] = useState<LeaveAction | null>(null)

  useEffect(() => {
    sessionCache = { tabs, activeTabId, recentlyClosed }
  })

  // GH407 — état lu par la garde au moment de l'appel : une ouverture faite après un `await`
  // (résolution de merge, ligne de la vue Suivi, exécution) tient un `attemptOpenTab` d'un rendu
  // antérieur, qui ne voyait pas une saisie commencée pendant l'attente.
  const latest = useRef({ dirtyTabIds, activeTabId })
  latest.current = { dirtyTabIds, activeTabId }
  /** GH407 — saisie d'un onglet reçu d'une autre fenêtre et pas encore affiché (page active modifiée,
   *  « Rester ») : remise à sa page quand il est activé, ou repartie avec lui s'il est re-glissé. */
  const incomingDrafts = useRef(new Map<string, NonNullable<TabDragPayload['draft']>>())

  const goTo = useCallback((tab: Pick<Tab, 'pathname' | 'searchParams'>, replace = false) => {
    navigate({ to: tab.pathname as never, search: tab.searchParams as never, replace, state: TAB_NAV_STATE as never })
  }, [navigate])

  // GH228 — une navigation PUSH de l'application (hors TabsProvider) vers une autre URL depuis le
  // dernier rendu = nouvelle page dans l'historique de l'onglet. Consommé par l'effet ci-dessous :
  // un PUSH suivi d'une redirection REPLACE avant le rendu ne donne qu'une entrée, à l'URL finale.
  // Un PUSH vers l'URL courante (re-clic) ne compte pas : l'effet ne tournerait pas pour le
  // consommer. Les retours natifs du navigateur (client web : BACK/FORWARD/GO) ne font que
  // remplacer l'entrée courante.
  useEffect(() => {
    let lastHref = router.history.location.href
    return router.history.subscribe(({ location, action }) => {
      const sameUrl = location.href === lastHref
      lastHref = location.href
      if ((location.state as { polentaTabNav?: boolean } | undefined)?.polentaTabNav) return
      if (action.type === 'PUSH' && !sameUrl) pendingPush = true
    })
  }, [router])

  // Keeps the active tab's stored URL in sync with normal in-app navigation (clicking a
  // requirement, changing a filter…) — this is what lets switching away and back restore the
  // exact position without every navigate() having to know about tabs.
  // GH228 — layout effect: runs before the views' useSetTabTitle (passive) effects of the same
  // commit, so a refined title lands on the new history entry, never on the page just left.
  useLayoutEffect(() => {
    const push = pendingPush
    pendingPush = false
    const searchParams = parseSearch(search)
    const title = defaultTitleForPathname(pathname, t)
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, pathname, searchParams, title, ...recordLocation(tab, { pathname, searchParams, title }, push) }
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

  /** Non gardé (passer par `attemptOpenTab`). Appelé après un `await` (hors d'un événement), il doit
   *  l'être sous `flushSync` : sinon la mise à jour (synchrone) de l'URL par le routeur est rendue
   *  avant l'activation du nouvel onglet, et l'effet de synchronisation réécrit l'onglet précédent
   *  (GH37). */
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
    const draft = incomingDrafts.current.get(id)
    if (draft) {
      incomingDrafts.current.delete(id)
      stageIncomingDraft(draft)
    }
    setActiveTabId(id)
    goTo(tab)
  }

  function closeTab(id: string) {
    const index = tabs.findIndex(item => item.id === id)
    if (index === -1) return
    incomingDrafts.current.delete(id)

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
      const tab: Tab = { ...makeTab(home.pathname, home.searchParams, t), id: original.id }
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
      // GH228 — l'entrée courante de l'historique porte le même titre (menu Précédent / Suivant).
      const history = tab.history.map((entry, i) => i === tab.historyIndex ? { ...entry, title: nextTitle } : entry)
      return prev.map(item => item.id === id ? { ...item, title: nextTitle, history } : item)
    })
  }, [])

  function reopenClosedTab(id: string) {
    const closed = recentlyClosed.find(item => item.id === id)
    if (!closed) return
    setRecentlyClosed(prev => prev.filter(rc => rc.id !== id))
    // GH228 — l'onglet rouvert retrouve son historique, comme dans un navigateur.
    const tab: Tab = { ...closed, id: crypto.randomUUID() }
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    goTo(tab)
  }

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]

  /** GH228 — va à l'entrée `index` de l'historique de l'onglet actif, sans garde. L'effet de
   *  synchronisation remplace ensuite cette entrée par l'URL normalisée par le routeur. */
  function goToHistoryIndex(index: number) {
    const entry = activeTab.history[index]
    if (!entry) return
    setTabs(prev => prev.map(tab => tab.id === activeTab.id ? { ...tab, historyIndex: index } : tab))
    goTo(entry, true)
  }

  function runLeave(action: LeaveAction) {
    switch (action.kind) {
      case 'history': goToHistoryIndex(action.index); break
      case 'activate': activateTab(action.id); break
      case 'open': openTab(action.pathname, action.searchParams); break
      case 'reopen': reopenClosedTab(action.id); break
    }
  }

  /** GH228 / GH405 — même séquence que attemptCloseTab : l'enregistrement au blur du champ actif
   *  d'abord, puis la popup si l'onglet actif reste dirty (sa page va être démontée). */
  function attemptLeave(action: LeaveAction) {
    const active = document.activeElement
    if (active && isEditableElement(active)) (active as HTMLElement).blur()
    const { dirtyTabIds: dirty, activeTabId: activeId } = latest.current
    if (dirty.has(activeId)) {
      setPendingLeave(action)
      return
    }
    runLeave(action)
  }

  /** See TabsContextValue.attemptHistoryNav. */
  function attemptHistoryNav(index: number) {
    if (index === activeTab.historyIndex || !activeTab.history[index]) return
    attemptLeave({ kind: 'history', index })
  }

  function attemptActivateTab(id: string) {
    if (id === activeTabId || !tabs.some(tab => tab.id === id)) return
    attemptLeave({ kind: 'activate', id })
  }

  function attemptOpenTab(pathname?: string, searchParams?: Record<string, string>) {
    attemptLeave({ kind: 'open', pathname, searchParams })
  }

  function attemptReopenClosedTab(id: string) {
    if (!recentlyClosed.some(tab => tab.id === id)) return
    attemptLeave({ kind: 'reopen', id })
  }

  function confirmLeave() {
    if (pendingLeave) runLeave(pendingLeave)
    setPendingLeave(null)
  }

  function cancelLeave() {
    setPendingLeave(null)
  }

  // ─── GH343 — glisser un onglet ─────────────────────────────────────────────────────────────────

  function moveTab(id: string, toIndex: number) {
    setTabs(prev => {
      const from = prev.findIndex(tab => tab.id === id)
      if (from === -1) return prev
      const target = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, prev.length - 1))
      if (target === from) return prev
      const next = prev.filter(tab => tab.id !== id)
      next.splice(target, 0, prev[from])
      return next
    })
  }

  function detachTab(id: string) {
    const index = tabs.findIndex(item => item.id === id)
    if (index === -1) return
    incomingDrafts.current.delete(id)
    setDirtyTabIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (tabs.length === 1) {
      // Rien ne reste dans cette fenêtre : elle se ferme, sans garde (la saisie est partie avec l'onglet).
      void api.app.closeWindow('close')
      return
    }
    const remaining = tabs.filter(item => item.id !== id)
    setTabs(remaining)
    if (id === activeTabId) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)]
      setActiveTabId(neighbor.id)
      goTo(neighbor)
    }
  }

  function adoptTab(incoming: TabDragPayload['tab'], index?: number, draft?: TabDragPayload['draft']) {
    const tab: Tab = { ...incoming, id: crypto.randomUUID() }
    const incomingProject = deriveCurrentProjectId(new URLSearchParams(incoming.searchParams).toString())
    if (currentProjectId === null) {
      // Fenêtre à l'accueil : elle ouvre le projet de l'onglet, qui remplace ses onglets d'accueil.
      // Projet connu d'avance : l'arrivée sur ce projet n'est pas un changement de projet (pas de remise à zéro).
      lastNonNullProjectId.current = incomingProject
      setTabs([tab])
    } else {
      setTabs(prev => {
        const next = [...prev]
        next.splice(index === undefined ? next.length : Math.max(0, Math.min(index, next.length)), 0, tab)
        return next
      })
      // GH407 — l'activer démonterait la page active modifiée : l'onglet reste en arrière-plan (il
      // ne peut plus retourner dans sa fenêtre d'origine) et la garde décide de son activation.
      const { dirtyTabIds: dirty, activeTabId: activeId } = latest.current
      if (dirty.has(activeId)) {
        if (draft) incomingDrafts.current.set(tab.id, draft)
        if (!pendingLeave && !pendingCloseId) setPendingLeave({ kind: 'activate', id: tab.id })
        return
      }
    }
    stageIncomingDraft(draft)
    setActiveTabId(tab.id)
    goTo(tab)
  }

  function snapshotTab(id: string): Pick<TabDragPayload, 'tab' | 'draft'> | null {
    const tab = tabs.find(item => item.id === id)
    if (!tab) return null
    const { pathname, searchParams, title, history, historyIndex } = tab
    // Seule la page de l'onglet actif est montée : un onglet inactif n'a pas de saisie en cours,
    // sauf celle d'un onglet reçu pas encore affiché (GH407).
    const draft = id === activeTabId ? captureActiveDraft() : incomingDrafts.current.get(id)
    return { tab: { pathname, searchParams, title, history, historyIndex }, ...(draft ? { draft } : {}) }
  }

  return (
    <TabsContext.Provider value={{
      tabs, activeTabId, recentlyClosed, dirtyTabIds, closeTab, attemptCloseTab,
      attemptActivateTab, attemptOpenTab, attemptReopenClosedTab,
      pendingCloseId, confirmCloseTab, cancelCloseTab, setTabDirty, setTabTitleOverride,
      activeTab, attemptHistoryNav, pendingLeave, confirmLeave, cancelLeave,
      moveTab, detachTab, adoptTab, snapshotTab,
    }}>
      {children}
    </TabsContext.Provider>
  )
}
