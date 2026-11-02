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
