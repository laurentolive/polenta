import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { ValidationState } from '@polenta/types'
import { VALIDATION_ERROR_CODES } from '@polenta/types'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'

// GH204 — requêtes des validations. Toutes les clés commencent par `validations` : `useLiveFileSync`
// les invalide d'un coup (validation, exigence, test, exécution, version, lien ou schéma modifiés).

export function isValidationPath(pathname: string): boolean {
  return pathname === '/validations' || pathname.startsWith('/validation/')
}

export function useValidationVersions(repoPath: string) {
  return useQuery({
    queryKey: ['validations', 'versions', repoPath],
    queryFn: () => api.validations.versions(repoPath),
    enabled: !!repoPath,
  })
}

export function useValidationPage(repoPath: string, id: string, projectId: string) {
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['validations', 'page', repoPath, id, workspaceDir],
    queryFn: () => api.validations.page(repoPath, id, workspaceDir || undefined),
    enabled: !!repoPath && !!id,
  })
}

export function useInvalidateValidations() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['validations'] })
}

export function validationErrorText(t: TFunction, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  for (const code of VALIDATION_ERROR_CODES) {
    const i = message.indexOf(`${code}: `)
    if (i >= 0) return t(`validation.errors.${code}`, { detail: message.slice(i + code.length + 2) })
  }
  return message
}

export const VALIDATION_STATE_BADGE: Record<ValidationState, string> = {
  open: 'bg-status-info-bg text-status-info',
  signed: 'bg-status-success-bg text-status-success',
  cancelled: 'bg-hover text-ink-3',
}
