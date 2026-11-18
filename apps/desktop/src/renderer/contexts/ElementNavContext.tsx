import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { ObjectCategory } from '@polenta/types'
import { api } from '../api'
import { runPage } from '../lib/executionsRoute'
import { useWorkspaceLinks, type WorkspaceLinks } from '../hooks/useWorkspaceLinks'
import { normRepoPath } from '../components/system/linkUtils'
import { treeFindByObjectId } from '../hooks/useTreeState'
import { useSystemView } from './SystemViewContext'
import { useTabs } from './TabsContext'

/**
 * GH229 — liens de navigation sur les ID d'élément (specs/GH229-design.md §3–4).
 *
 * Un seul point d'entrée pour tout ID référencé à l'écran : l'index du workspace (exigences,
 * tests — `useWorkspaceLinks`, cache partagé avec la vue système — et campagnes de chaque repo),
 * la navigation (`follow` : clic = page de la vue système dans le dernier type de vue, Ctrl /
 * Cmd / clic du milieu = la même page dans un nouvel onglet) et le contrôleur de la popup
 * d'aperçu, unique pour toute l'application (une popup à la fois, survol de 500 ms).
 *
 * L'état de la popup vit dans un contexte à part (`ElementPreviewStateContext`, lu par la popup
 * seule) : ouvrir ou fermer la popup ne re-rend pas les liens de la page.
 */

/** Cible d'un lien : catégorie d'objet, ou exécution (GH399). */
export type NavCategory = ObjectCategory | 'run'

export interface ElementRef {
  id: string
  /** Texte des liens : `displayIdField` du type, sinon l'ID. */
  displayId: string
  title: string
  status: string
  category: NavCategory
  /** Exécution : type de son test (réglage `runPopup`). */
  objectTypeRef: string
  repoPath: string
  repoLabel?: string
  /** GH399 — exécution : son test. */
  testId?: string
}

/** GH399 — ligne d'historique d'une exécution (popup, navigation) : même clé pour les deux. */
export const runQueryKey = (repoPath: string, runId: string, workspaceDir: string | undefined) =>
  ['execution-run', repoPath, runId, workspaceDir ?? null] as const

export interface ElementPreviewTarget {
  id: string
  anchor: DOMRect
}

export interface ElementNav {
  /** Index chargé : avant, un ID absent n'est pas encore « introuvable ». */
  ready: boolean
  /** Change à chaque rechargement de l'index (re-rendu du HTML des richtext). */
  version: number
  resolve: (id: string) => ElementRef | null
  follow: (id: string, opts?: { newTab?: boolean }) => void
  workspace: WorkspaceLinks
  // Popup d'aperçu (fonctions stables)
  hover: (id: string, anchor: HTMLElement) => void
  leave: () => void
  /** Le pointeur entre dans la popup : annule la fermeture. */
  holdPreview: () => void
  closePreview: () => void
}

/** GH229 — délais de la popup (spec §5.1). */
export const PREVIEW_OPEN_DELAY_MS = 500
export const PREVIEW_CLOSE_DELAY_MS = 200

const ElementNavContext = createContext<ElementNav | null>(null)
const ElementPreviewStateContext = createContext<ElementPreviewTarget | null>(null)

/** `null` hors projet ouvert (routes nues : impression, export) — les ID restent du texte. */
export function useElementNav(): ElementNav | null {
  return useContext(ElementNavContext)
}

/** Cible de la popup ouverte (popup d'aperçu seulement). */
export function useElementPreviewTarget(): ElementPreviewTarget | null {
  return useContext(ElementPreviewStateContext)
}

/** Vrai dans la popup d'aperçu : ses liens ne rouvrent pas de popup imbriquée. */
export const InPreviewContext = createContext(false)

export function ElementNavProvider({ currentProjectId, children }: { currentProjectId: string; children: ReactNode }) {
  const wsLive = useWorkspaceLinks(currentProjectId)
  // `useWorkspaceLinks` rend un objet neuf à chaque rendu : figé sur ses données, sinon chaque
  // rendu du provider (survol, navigation) re-rendrait tous les liens de l'application.
  const ws = useMemo(() => wsLive, [ // eslint-disable-line react-hooks/exhaustive-deps
    wsLive.objects, wsLive.objectsLoaded, wsLive.links, wsLive.linksByObjectId, wsLive.linkTypes,
    wsLive.rootRepoPath, wsLive.workspaceDir, wsLive.repoLabelOf, wsLive.linksPending,
  ])
  const sv = useSystemView()
  const qc = useQueryClient()
  // GH407 — ouverture gardée : un Ctrl+clic depuis une page modifiée passe par « Quitter cette page ? ».
  const { attemptOpenTab } = useTabs()
  const navigate = useNavigate()
  const { pathname, searchStr } = useRouterState({ select: s => ({ pathname: s.location.pathname, searchStr: s.location.searchStr }) })

  // Campagnes : un index par repo du workspace (repos qui portent des objets, racine comprise).
  // Même clé que le sélecteur de tests : invalidée par les écritures et `useLiveFileSync`.
  const repoPaths = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of [ws.rootRepoPath, ...ws.objects.map(o => o.repoPath)]) if (p && !seen.has(normRepoPath(p))) seen.set(normRepoPath(p), p)
    return [...seen.values()]
  }, [ws.rootRepoPath, ws.objects])
  const campaignQueries = useQueries({
    queries: repoPaths.map(repoPath => ({
      queryKey: ['campaigns', repoPath],
      queryFn: () => api.campaigns.list(repoPath),
      enabled: !!repoPath,
    })),
  })
  const campaignsKey = campaignQueries.map(q => q.dataUpdatedAt).join('|')
  // GH389 — versions et validations : liens vers leur page, popup en-tête seul. Clés propres à l'index
  // (`element-nav`), relues par `useLiveFileSync` une fois une rafale de changements passée : actives
  // sur toutes les pages, les clés des écrans (`versions`, `validations`) seraient relues à chaque
  // fichier écrit (des centaines de requêtes à l'amorçage de Suivi).
  const versionQueries = useQueries({
    queries: repoPaths.map(repoPath => ({
      queryKey: ['element-nav', 'versions', repoPath],
      queryFn: () => api.versions.list(repoPath),
      enabled: !!repoPath,
    })),
  })
  const validationQueries = useQueries({
    queries: repoPaths.map(repoPath => ({
      queryKey: ['element-nav', 'validations', repoPath],
      queryFn: () => api.validations.versions(repoPath),
      enabled: !!repoPath,
    })),
  })
  // GH399 — exécutions : ID de chaque repo (rangées dans le repo de leur test), même rythme de relecture.
  const runQueries = useQueries({
    queries: repoPaths.map(repoPath => ({
      queryKey: ['element-nav', 'runs', repoPath],
      queryFn: () => api.executions.runIds(repoPath),
      enabled: !!repoPath,
    })),
  })
  const versionsKey = [...versionQueries, ...validationQueries, ...runQueries].map(q => q.dataUpdatedAt).join('|')

  const index = useMemo(() => {
    const map = new Map<string, ElementRef>()
    for (const o of ws.objects) {
      map.set(o.id, {
        id: o.id, displayId: o.displayId ?? o.id, title: o.title, status: o.status, category: o.category,
        objectTypeRef: o.objectTypeRef, repoPath: o.repoPath, repoLabel: o.repoLabel,
      })
    }
    campaignQueries.forEach((q, i) => {
      for (const c of q.data ?? []) {
        if (map.has(c.id)) continue
        map.set(c.id, {
          id: c.id, displayId: c.id, title: c.title ?? c.id, status: c.status, category: 'campaign',
          objectTypeRef: c.objectTypeRef ?? '', repoPath: repoPaths[i], repoLabel: ws.repoLabelOf(repoPaths[i]),
        })
      }
    })
    const add = (ref: ElementRef) => { if (!map.has(ref.id)) map.set(ref.id, ref) }
    versionQueries.forEach((q, i) => {
      for (const v of q.data ?? []) {
        add({ id: v.id, displayId: v.id, title: v.title, status: v.state, category: 'version', objectTypeRef: '', repoPath: repoPaths[i], repoLabel: ws.repoLabelOf(repoPaths[i]) })
      }
    })
    validationQueries.forEach((q, i) => {
      for (const { validation: val } of q.data ?? []) {
        if (val) add({ id: val.id, displayId: val.id, title: val.title, status: val.state, category: 'validation', objectTypeRef: '', repoPath: repoPaths[i], repoLabel: ws.repoLabelOf(repoPaths[i]) })
      }
    })
    // GH399 — exécution d'un test connu (test supprimé : non indexée, l'ID reste du texte).
    runQueries.forEach((q, i) => {
      for (const r of q.data ?? []) {
        const test = map.get(r.testCaseId)
        if (!test || test.category !== 'test') continue
        add({
          id: r.id, displayId: r.id, title: test.title, status: '', category: 'run', objectTypeRef: test.objectTypeRef,
          repoPath: repoPaths[i], repoLabel: ws.repoLabelOf(repoPaths[i]), testId: r.testCaseId,
        })
      }
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.objects, campaignsKey, versionsKey, repoPaths, ws.repoLabelOf])

  const versionRef = useRef(0)
  const version = useMemo(() => ++versionRef.current, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = useCallback((id: string) => index.get(id) ?? null, [index])

  // ── Popup ──────────────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<ElementPreviewTarget | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = closeTimer.current = null
  }
  const closePreview = useCallback(() => {
    clearTimers()
    setPreview(null)
  }, [])
  const hover = useCallback((id: string, anchor: HTMLElement) => {
    clearTimers()
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      if (anchor.isConnected) setPreview({ id, anchor: anchor.getBoundingClientRect() })
    }, PREVIEW_OPEN_DELAY_MS)
  }, [])
  const leave = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setPreview(null) }, PREVIEW_CLOSE_DELAY_MS)
  }, [])
  const holdPreview = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  useEffect(() => clearTimers, [])
  // Changement de page : la popup (et un survol armé) n'a plus d'ancre.
  useEffect(() => { closePreview() }, [pathname, searchStr, closePreview])

  // ── Navigation ─────────────────────────────────────────────────────────────
  const svRef = useRef(sv)
  svRef.current = sv
  const follow = useCallback((id: string, opts?: { newTab?: boolean }) => {
    const target = index.get(id)
    if (!target) return
    closePreview()
    // Comme Précédent (GH228) : le champ actif est quitté, donc enregistré s'il s'enregistre seul.
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()

    let page: { pathname: string; search: Record<string, string> }
    if (target.category === 'run') {
      // GH399 — page de l'exécution selon sa campagne et son entrée (ligne relue, en cache après un survol).
      // Page quittée entre-temps (autre lien, autre onglet) : la navigation tardive est abandonnée.
      const from = window.location.href
      void qc.fetchQuery({
        queryKey: runQueryKey(target.repoPath, id, ws.workspaceDir),
        queryFn: () => api.executions.history(target.repoPath, { runId: id, testId: target.testId }, ws.workspaceDir),
        staleTime: 5_000,
      }).then(history => {
        const row = history.rows[0]
        const runTarget = row ? runPage(row, target.repoPath, currentProjectId) : null
        if (!runTarget || window.location.href !== from) return
        // Après un `await` : sous flushSync (GH37, `openTab` de TabsContext).
        if (opts?.newTab) { flushSync(() => attemptOpenTab(runTarget.pathname, runTarget.search)); return }
        if (window.location.pathname.endsWith(runTarget.pathname)) return
        navigate({ to: runTarget.pathname as never, search: runTarget.search as never })
      }).catch(err => console.error('[ElementNav] exécution', id, err))
      return
    } else if (target.category === 'campaign') {
      page = { pathname: `/campaign/${id}`, search: { repoPath: target.repoPath, projectId: currentProjectId } }
    } else if (target.category === 'version' || target.category === 'validation') {
      page = { pathname: `/${target.category}/${id}`, search: { projectId: currentProjectId, repoPath: target.repoPath } }
    } else {
      const [nodeId, typeId] = target.objectTypeRef.split('::')
      if (!nodeId || !typeId) return
      const s = svRef.current
      page = s.objectPage(target.repoPath, nodeId, typeId, s.viewModeForLink(target.repoPath), id, target.category)
    }
    if (opts?.newTab) {
      attemptOpenTab(page.pathname, page.search)
      return
    }
    // Lien vers la page affichée : re-goto (re-défilement), pas de nouvelle entrée d'historique.
    const current = new URLSearchParams(window.location.search)
    const same = window.location.pathname.endsWith(page.pathname)
      && Object.entries(page.search).every(([k, v]) => (current.get(k) ?? '') === v)
    if (same) {
      if (target.category === 'version' || target.category === 'validation') return
      const s = svRef.current
      const node = treeFindByObjectId(s.root, id)
      if (node && s.viewMode !== 'edit') s.requestGoto(node.id)
      return
    }
    navigate({ to: page.pathname as never, search: page.search as never })
  }, [index, closePreview, currentProjectId, attemptOpenTab, navigate, qc, ws.workspaceDir])

  const value = useMemo<ElementNav>(() => ({
    ready: ws.objectsLoaded,
    version,
    resolve,
    follow,
    workspace: ws,
    hover,
    leave,
    holdPreview,
    closePreview,
  }), [ws, version, resolve, follow, hover, leave, holdPreview, closePreview])

  return (
    <ElementNavContext.Provider value={value}>
      <ElementPreviewStateContext.Provider value={preview}>
        {children}
      </ElementPreviewStateContext.Provider>
    </ElementNavContext.Provider>
  )
}
