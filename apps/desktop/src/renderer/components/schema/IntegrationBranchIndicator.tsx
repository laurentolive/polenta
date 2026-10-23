import { useQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { WorkspaceTreeNode } from '@polenta/types'
import { api } from '../../api'
import { designateNotices, useDesignateIntegration } from '../../hooks/useDesignateIntegration'
import { branchErrorText } from '../../lib/branchErrors'
import { BranchNotices } from '../sidebar/version/BranchNotices'
import { PinPropagationWarning } from '../sidebar/version/PinPropagationWarning'

/**
 * GH106 — branche d'intégration sur la ligne d'un repo de l'onglet Structure, **seulement quand
 * elle diffère de ce qui est checkouté** (sinon la combo de branche dit déjà tout). Le choix d'une
 * branche se fait dans la combo (`RepoBranchSelector`, qui marque l'intégration dans sa liste ;
 * y créer une `int-*` la désigne) ; ici :
 * - branche courante `int-X` non désignée (cas PH2) : ⚠ « Désigner `int-X` » ;
 * - autre branche ou detached HEAD (composant épinglé sur un commit) : « Intégration : `int-Y` »,
 *   pour information.
 * Masqué sur `dev-*` (modification en cours : l'écart avec l'intégration est normal).
 */
export function IntegrationBranchIndicator({ node, workspaceDir, flatNodes }: {
  node: { repoPath: string; name: string; label?: string }
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
}) {
  const { t } = useTranslation()
  const { repoPath } = node
  const { data: state } = useQuery({
    queryKey: ['integration:state', repoPath],
    queryFn: () => api.integration.state(repoPath),
    enabled: !!repoPath,
    refetchInterval: 10_000,
  })
  const designation = useDesignateIntegration(workspaceDir, flatNodes)

  const notices = [
    ...(designation.outcome ? designateNotices(designation.outcome, t) : []),
    ...(designation.error ? [branchErrorText(designation.error)] : []),
  ]
  const feedback = (
    <>
      <BranchNotices notices={notices} onDismiss={designation.reset} />
      <PinPropagationWarning outcome={designation.pinWarning} onDismiss={designation.dismissPinWarning} />
    </>
  )

  const hidden = !state || state.currentBranch === state.configured || state.currentBranch.startsWith('dev-')
  if (hidden) return <div className="shrink-0" onClick={e => e.stopPropagation()}>{feedback}</div>

  return (
    <div className="shrink-0" onClick={e => e.stopPropagation()}>
      {state.status === 'incoherent' ? (
        <button
          type="button"
          onClick={() => { designation.reset(); designation.designate(repoPath, state.currentBranch) }}
          disabled={designation.isPending}
          className="flex items-center gap-1 text-xs text-status-warning hover:underline disabled:opacity-60"
          title={t('schema.integrationIndicator.incoherentHint', { branch: state.currentBranch, configured: state.configured })}
        >
          <AlertTriangle size={12} className="shrink-0" />
          {designation.isPending
            ? t('layout.modificationControl.designating')
            : t('schema.integrationIndicator.designate', { branch: state.currentBranch })}
        </button>
      ) : (
        <span
          className="text-xs text-ink-3"
          title={state.status === 'detached'
            ? t('schema.integrationIndicator.detachedHint', { commit: state.headOid.slice(0, 7) })
            : t('schema.integrationIndicator.otherHint', { branch: state.currentBranch })}
        >
          <Trans
            i18nKey="schema.integrationIndicator.label"
            values={{ branch: state.configured }}
            components={{ mono: <span className="font-mono" /> }}
          />
        </span>
      )}
      {feedback}
    </div>
  )
}
