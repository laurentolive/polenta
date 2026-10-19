import { useState } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { DesignateOutcome, WorkspaceTreeNode } from '@polenta/types'
import { api } from '../api'
import { propagatePinToDependents, type PinPropagationOutcome } from '../lib/workspaceActions'

/** GH106 — every query that reads the designated integration branch of `repoPath`. */
export function invalidateIntegration(qc: QueryClient, repoPath: string) {
  qc.invalidateQueries({ queryKey: ['baseline:integration-branch', repoPath] })
  qc.invalidateQueries({ queryKey: ['integration:state', repoPath] })
}

/**
 * GH106 — « Désigner » (specs/GH106-design.md §3.2) : `integration:designate` (checkout si besoin,
 * commit du seul `config/project.yaml`, push, branche par défaut de la forge), puis propagation du
 * pin vers les repos parents, comme après un checkout. Partagé par le bandeau de « Publier » et
 * l'indicateur de l'onglet Structure.
 */
type DesignateOp = { repoPath: string; branch: string }

export function useDesignateIntegration(workspaceDir: string, flatNodes: WorkspaceTreeNode[]) {
  const qc = useQueryClient()
  const [pinWarning, setPinWarning] = useState<PinPropagationOutcome | null>(null)

  function invalidateAll(repoPath: string) {
    qc.invalidateQueries({ queryKey: ['sync:status'] })
    qc.invalidateQueries({ queryKey: ['sync:branches', repoPath] })
    qc.invalidateQueries({ queryKey: ['sync:integration-state'] })
    qc.invalidateQueries({ queryKey: ['workspace-open', workspaceDir] })
    invalidateIntegration(qc, repoPath)
  }

  const mutation = useMutation({
    mutationFn: (op: DesignateOp) => api.integration.designate(op.repoPath, op.branch),
    onSuccess: async (outcome, { repoPath }) => {
      // Refreshed right away, not after the pin-propagation cascade below.
      invalidateAll(repoPath)
      const node = flatNodes.find(n => n.repoPath === repoPath)
      if (!node) return
      const pinOutcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, outcome.branch)
      // The parents' manifests just changed: re-read the tree, whose displayed pins come from them.
      if (pinOutcome.updated.length > 0) qc.invalidateQueries({ queryKey: ['workspace-open', workspaceDir] })
      setPinWarning(pinOutcome)
    },
    onError: (_err, { repoPath }) => invalidateAll(repoPath),
  })

  return {
    designate: (repoPath: string, branch: string) => mutation.mutate({ repoPath, branch }),
    designateAsync: (repoPath: string, branch: string) => mutation.mutateAsync({ repoPath, branch }),
    isPending: mutation.isPending,
    error: mutation.error,
    outcome: mutation.data ?? null,
    reset: mutation.reset,
    pinWarning,
    dismissPinWarning: () => setPinWarning(null),
  }
}

/** Lignes à afficher après une désignation ; vide quand tout s'est bien passé. */
export function designateNotices(outcome: DesignateOutcome, t: TFunction): string[] {
  const out: string[] = []
  if (typeof outcome.push === 'object') out.push(t('integration.notice.pushFailed', { branch: outcome.branch, error: outcome.push.error }))
  const d = outcome.defaultBranch
  if (d === 'not-admin') out.push(t('integration.notice.defaultNotAdmin', { branch: outcome.branch }))
  else if (typeof d === 'object') out.push(t('integration.notice.defaultFailed', { error: d.error }))
  return out
}
