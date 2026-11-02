import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { ObjectTypeDefinition, VersionErrorCode, VersionState } from '@polenta/types'
import { VERSION_ERROR_CODES } from '@polenta/types'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useSelectedRepo } from '../../contexts/SelectedRepoContext'

// GH201 — requêtes des versions. Toutes les clés commencent par `versions` : `useLiveFileSync`
// les invalide d'un coup (changement de version, d'élément, de schéma ou de dépendances).

/** Routes du sous-panneau « Produit » (accueil, backlog, page d'une version) — panneau Version. */
export function isProductVersionsPath(pathname: string): boolean {
  return pathname === '/versions' || pathname.startsWith('/versions/') || pathname.startsWith('/version/')
}

export function useVersionTree(projectId: string) {
  const { rootRepoPath } = useSelectedRepo()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['versions', 'tree', rootRepoPath, workspaceDir],
    queryFn: () => api.versions.tree(rootRepoPath, workspaceDir || undefined),
    enabled: !!rootRepoPath,
  })
}

export function useVersionPage(repoPath: string, id: string, projectId: string) {
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['versions', 'page', repoPath, id, workspaceDir],
    queryFn: () => api.versions.get(repoPath, id, workspaceDir || undefined),
    enabled: !!repoPath && !!id,
  })
}

export function useVersionBacklog(repoPath: string) {
  return useQuery({
    queryKey: ['versions', 'backlog', repoPath],
    queryFn: () => api.versions.backlog(repoPath),
    enabled: !!repoPath,
  })
}

const SECTIONS_KEY = 'polenta:versionSections'

/** GH245 — section repliable de la page d'une version, état mémorisé par poste (ouverte par défaut). */
export function useSectionOpen(section: string): [boolean, (fn: (open: boolean) => boolean) => void] {
  const read = (): Record<string, boolean> => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean> } catch { return {} }
  }
  const [open, setOpenState] = useState<boolean>(() => read()[section] ?? true)
  const setOpen = (fn: (open: boolean) => boolean) => setOpenState(prev => {
    const next = fn(prev)
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...read(), [section]: next })) } catch { /* stockage indisponible */ }
    return next
  })
  return [open, setOpen]
}

/** GH245 — analyse d'impact et tests à exécuter d'une version (un seul calcul ; pas pour une abandonnée). */
export function useVersionImpact(repoPath: string, id: string, projectId: string, enabled: boolean) {
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['versions', 'impact', repoPath, id, workspaceDir],
    queryFn: () => api.versions.impact(repoPath, id, workspaceDir || undefined),
    enabled: !!repoPath && !!id && enabled,
    // Les campagnes évoluent ailleurs (création, ajout) : relu à chaque affichage.
    staleTime: 0,
  })
}

export function useInvalidateVersions() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['versions'] })
}

/** Code et détail d'une `VersionError` (`CODE: détail`, préfixé par l'IPC Electron). */
export function parseVersionError(err: unknown): { code: VersionErrorCode | null; detail: string } {
  const message = err instanceof Error ? err.message : String(err)
  for (const code of VERSION_ERROR_CODES) {
    const i = message.indexOf(`${code}: `)
    if (i >= 0) return { code, detail: message.slice(i + code.length + 2) }
  }
  return { code: null, detail: message }
}

export function versionErrorText(t: TFunction, err: unknown): string {
  const { code, detail } = parseVersionError(err)
  return code ? t(`versions.errors.${code}`, { detail }) : detail
}

export function statusLabel(typeDef: Pick<ObjectTypeDefinition, 'statuses'> | null | undefined, status: string): string {
  return typeDef?.statuses?.find(s => s.name === status)?.label || status
}

export const STATE_BADGE: Record<VersionState, string> = {
  in_progress: 'bg-status-info-bg text-status-info',
  released: 'bg-status-success-bg text-status-success',
  abandoned: 'bg-hover text-ink-3',
}

/**
 * Sélection multiple de lignes (`ids` dans l'ordre affiché) : clic = une ligne, MAJ + clic = la plage
 * depuis la dernière ligne cliquée, qui prend l'état de la ligne cliquée. Les IDs disparus sortent
 * de la sélection.
 */
export function useRangeSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  useEffect(() => {
    setSelected(prev => {
      const known = new Set(ids)
      const next = new Set([...prev].filter(id => known.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [ids])
  const toggle = (id: string, shift: boolean) => {
    const from = shift && anchor.current ? ids.indexOf(anchor.current) : -1
    const to = ids.indexOf(id)
    setSelected(prev => {
      const next = new Set(prev)
      const on = !prev.has(id)
      const range = from >= 0 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
      for (const r of range) { if (on) next.add(r); else next.delete(r) }
      return next
    })
    anchor.current = id
  }
  const allSelected = ids.length > 0 && selected.size === ids.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids))
  return { selected, setSelected, toggle, allSelected, toggleAll }
}
