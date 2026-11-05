import { useTranslation } from 'react-i18next'
import type { TransitionCheck } from '@polenta/types'
import { useTransitionPreview } from '../../hooks/useTransitionPreview'

/** Options d'un `<select>` natif de statut, annotées par le pré-contrôle (GH206). */
export function statusOptionProps(
  check: TransitionCheck | undefined,
  label: string,
  t: (key: string) => string,
): { label: string; disabled: boolean; title?: string } {
  if (!check || check.issues.length === 0) return { label, disabled: false }
  const title = check.issues.map(i => i.message).join('\n')
  // Option bloquée : visible, désactivée, motif dans le libellé (une infobulle d'option n'est pas
  // affichée par tous les navigateurs). Option notifiée : active, marquée ⚠.
  return check.blocked
    ? { label: `${label} — ${t('transitions.option.blocked')} : ${check.issues.filter(i => i.level === 'block').map(i => i.message).join(' ; ')}`, disabled: true, title }
    : { label: `⚠ ${label}`, disabled: false, title }
}

/**
 * GH206 — options du menu de statut d'un objet : toutes les valeurs restent visibles ; une transition
 * bloquée est désactivée avec son motif, une transition notifiée est marquée ⚠. Sans contexte
 * (`TransitionScopeContext`) ou sans règle : options simples.
 */
export function TransitionStatusOptions({ objectId, current, values, labels, enabled = true }: {
  objectId: string | undefined
  current: string
  values: string[]
  labels?: Record<string, string>
  /** Charger le pré-contrôle (ex. seulement au focus du menu, dans une liste longue). */
  enabled?: boolean
}) {
  const { t } = useTranslation()
  const { data } = useTransitionPreview(objectId, enabled)
  return (
    <>
      {values.map(v => {
        const label = labels?.[v] ?? v
        const opt = v === current ? { label, disabled: false } : statusOptionProps(data?.[v], label, t)
        return (
          <option key={v} value={v} disabled={opt.disabled} title={opt.title ?? (labels?.[v] ? v : undefined)}>
            {opt.label}
          </option>
        )
      })}
    </>
  )
}
