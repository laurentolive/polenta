import { useTranslation } from 'react-i18next'
import type { CampaignTestRun } from '@polenta/types'
import { UnresolvedParamsBanner } from './UnresolvedParamsBanner'

/** T171 §7 — en tête des pages d'exécution et de relecture : source de résolution des paramètres
 *  (tag de baseline ou état courant au moment de l'ajout) et références restées non résolues.
 *  T179 — exigence pour laquelle l'instance a été générée (titre s'il a été figé via `{req.title}`). */
export function RunParamsInfo({ run }: { run: CampaignTestRun | undefined }) {
  const { t } = useTranslation()
  if (!run) return null
  const hasResolution = run.resolvedParams !== undefined || run.unresolvedParams !== undefined || run.paramSourceRef !== undefined
  if (!hasResolution && !run.requirementId) return null
  const reqTitle = run.resolvedParams?.['req.title']
  return (
    <div>
      {run.requirementId && (
        <p className="mb-2 rounded border border-edge bg-hover/30 px-3 py-2 text-xs text-ink">
          <span className="text-ink-3">{t('campaignParams.reqInstances.requirementOfInstance')}</span>{' '}
          <span className="font-mono">{run.requirementId}</span>
          {reqTitle && <span> — {reqTitle}</span>}
        </p>
      )}
      {hasResolution && (
        <p className="text-xs text-ink-3 mb-2">
          {run.paramSourceRef
            ? t('campaignParams.sourceTag', { tag: run.paramSourceRef })
            : t('campaignParams.sourceCurrent')}
        </p>
      )}
      <UnresolvedParamsBanner runs={[run]} />
    </div>
  )
}
