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
 * l'onglet Structure, qui y ajoute la création d'une nouvelle `int-*` (`integration:create`, après
 * un checkout préalable de `checkoutFirst` le cas échéant) : une seule mutation, donc un seul
 * état en cours / erreur / résultat à afficher.
 */
type DesignateOp =
  | { kind: 'designate'; repoPath: string; branch: string }
  | { kind: 'create'; repoPath: string; suffix: string; from?: { tag: string }; checkoutFirst?: { branch: string; returnTo: string } }

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
    mutationFn: async (op: DesignateOp) => {
      if (op.kind === 'designate') return api.integration.designate(op.repoPath, op.branch)
      if (!op.checkoutFirst) return api.integration.create(op.repoPath, op.suffix, op.from)
      await api.sync.checkoutBranch(op.repoPath, op.checkoutFirst.branch)
      try {
        return await api.integration.create(op.repoPath, op.suffix, op.from)
      } catch (err) {
        // The service rolls back to where it started (the integration branch): bring the user
        // back to the branch they were on before the preliminary checkout.
        await api.sync.checkoutBranch(op.repoPath, op.checkoutFirst.returnTo).catch(() => {})
        throw err
      }
    },
    onSuccess: async (outcome, { repoPath }) => {
      // Refreshed right away, not after the pin-propagation cascade below.
      invalidateAll(repoPath)
      const node = flatNodes.find(n => n.repoPath === repoPath)
      if (node) setPinWarning(await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, outcome.branch))
    },
    onError: (_err, { repoPath }) => invalidateAll(repoPath),
  })

  return {
    designate: (repoPath: string, branch: string) => mutation.mutate({ kind: 'designate', repoPath, branch }),
    designateAsync: (repoPath: string, branch: string) => mutation.mutateAsync({ kind: 'designate', repoPath, branch }),
    create: (repoPath: string, suffix: string, opts: { from?: { tag: string }; checkoutFirst?: { branch: string; returnTo: string } } = {}) =>
      mutation.mutateAsync({ kind: 'create', repoPath, suffix, ...opts }),
    isPending: mutation.isPending,
    error: mutation.error,
    /** Kind of the last operation — a failed creation is shown by its own dialog, not twice. */
    lastKind: mutation.variables?.kind ?? null,
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
