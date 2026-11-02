import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueries } from '@tanstack/react-query'
import type { ObjectCategory } from '@polenta/types'
import { api } from '../api'
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

export interface ElementRef {
  id: string
  /** Texte des liens : `displayIdField` du type, sinon l'ID. */
  displayId: string
  title: string
  status: string
  category: ObjectCategory
  objectTypeRef: string
  repoPath: string
  repoLabel?: string
}

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
  const { openTab } = useTabs()
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
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.objects, campaignsKey, repoPaths, ws.repoLabelOf])

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
    if (target.category === 'campaign') {
      page = { pathname: `/campaign/${id}`, search: { repoPath: target.repoPath, projectId: currentProjectId } }
    } else {
      const [nodeId, typeId] = target.objectTypeRef.split('::')
      if (!nodeId || !typeId) return
      const s = svRef.current
      page = s.objectPage(target.repoPath, nodeId, typeId, s.viewModeForLink(target.repoPath), id, target.category)
    }
    if (opts?.newTab) {
      openTab(page.pathname, page.search)
      return
    }
    // Lien vers la page affichée : re-goto (re-défilement), pas de nouvelle entrée d'historique.
    const current = new URLSearchParams(window.location.search)
    const same = window.location.pathname.endsWith(page.pathname)
      && Object.entries(page.search).every(([k, v]) => (current.get(k) ?? '') === v)
    if (same) {
      const s = svRef.current
      const node = treeFindByObjectId(s.root, id)
      if (node && s.viewMode !== 'edit') s.requestGoto(node.id)
      return
    }
    navigate({ to: page.pathname as never, search: page.search as never })
  }, [index, closePreview, currentProjectId, openTab, navigate])

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
