import { useTranslation } from 'react-i18next'
import type { CampaignTestRun } from '@polenta/types'
import { UnresolvedParamsBanner } from './UnresolvedParamsBanner'

/** T171 §7 — en tête des pages d'exécution et de relecture : source de résolution des paramètres
 *  (tag de baseline ou état courant au moment de l'ajout) et références restées non résolues. */
export function RunParamsInfo({ run }: { run: CampaignTestRun | undefined }) {
  const { t } = useTranslation()
  if (!run) return null
  const hasResolution = run.resolvedParams !== undefined || run.unresolvedParams !== undefined || run.paramSourceRef !== undefined
  if (!hasResolution) return null
  return (
    <div>
      <p className="text-xs text-ink-3 mb-2">
        {run.paramSourceRef
          ? t('campaignParams.sourceTag', { tag: run.paramSourceRef })
          : t('campaignParams.sourceCurrent')}
      </p>
      <UnresolvedParamsBanner runs={[run]} />
    </div>
  )
}
