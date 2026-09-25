import { useTranslation } from 'react-i18next'

/** Icône ⚠ « Impact à vérifier » (T172) affichée à côté du statut d'un élément marqué
 *  `needsRevalidation` — un élément lié a quitté l'approbation. Purement informative : le flag
 *  est levé depuis l'analyse d'impact (T173), pas ici. Même jeton de couleur que le statut de
 *  couverture `needs_revalidation` (`CoverageBadge`). */
export function RevalidationFlag({ show }: { show: boolean }) {
  const { t } = useTranslation()
  if (!show) return null
  const label = t('system.revalidation.tooltip')
  return (
    <span title={label} aria-label={label} role="img" className="text-[11px] leading-none text-status-warning shrink-0 cursor-help">
      ⚠
    </span>
  )
}
