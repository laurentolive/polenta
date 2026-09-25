import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { CampaignTestRun } from '@polenta/types'

/**
 * T171 §7 — bandeau des références de paramètres restées non résolues à l'ajout (tag de baseline
 * introuvable, paramètre absent, valeur vide, nœud inconnu). Liste chaque instance concernée ;
 * rien si toutes les références sont résolues. Utilisé dans la page campagne (notification après
 * l'ajout, persistante) et en tête des pages d'exécution et de relecture (une seule instance).
 */
export function UnresolvedParamsBanner({ runs }: { runs: CampaignTestRun[] }) {
  const { t } = useTranslation()
  const affected = runs.filter(r => (r.unresolvedParams?.length ?? 0) > 0)
  if (affected.length === 0) return null
  return (
    <div className="mb-3 rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
      <p className="flex items-center gap-1.5 font-medium mb-1">
        <AlertTriangle size={13} />
        {t('campaignParams.bannerTitle', { count: affected.length })}
      </p>
      <ul className="space-y-0.5 pl-5 list-disc">
        {affected.map(r => (
          <li key={r.entryId}>
            <span className="font-mono">{r.entryId}</span>
            {' — '}
            {r.unresolvedParams!.map(u => `{${u.ref}} (${t(`campaignParams.reason.${u.reason}`)}${u.reason === 'tag_not_found' && r.paramSourceRef ? ` : ${r.paramSourceRef}` : ''})`).join(', ')}
          </li>
        ))}
      </ul>
    </div>
  )
}
