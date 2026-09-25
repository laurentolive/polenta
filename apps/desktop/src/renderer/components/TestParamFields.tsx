import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { UnresolvedParam } from '@polenta/types'

interface Props {
  /** Références à saisir à la main (T97), dans l'ordre du test. */
  labels: string[]
  values: Record<string, string>
  onChange: (label: string, value: string) => void
  /** T171 — références lues dans la base : affichées en lecture seule. */
  resolved?: Record<string, string>
  /** T171 — références de base qui ne pourront pas être résolues, avec leur raison. */
  unresolved?: UnresolvedParam[]
}

/** Paramètres d'un test à l'ajout en campagne (nouvelle ou existante) et pour l'édition des
 *  valeurs saisies. Rendu conditionnel — rien si le test n'a aucune référence à montrer. */
export function TestParamFields({ labels, values, onChange, resolved = {}, unresolved = [] }: Props) {
  const { t } = useTranslation()
  const resolvedEntries = Object.entries(resolved)
  if (labels.length === 0 && resolvedEntries.length === 0 && unresolved.length === 0) return null

  return (
    <div className="pl-6 pb-2 space-y-1.5 border-l-2 border-edge ml-2">
      {resolvedEntries.map(([ref, value]) => (
        <div key={ref} className="flex items-center gap-2 text-xs" title={t('campaignParams.fromBase')}>
          <span className="font-mono text-ink-3 shrink-0 w-24 truncate" title={ref}>{'{' + ref + '}'}</span>
          <span className="param-ref">{value}</span>
        </div>
      ))}
      {unresolved.map(u => (
        <div key={u.ref} className="flex items-center gap-2 text-xs text-status-warning">
          <span className="font-mono shrink-0 w-24 truncate" title={u.ref}>{'{' + u.ref + '}'}</span>
          <AlertTriangle size={12} className="shrink-0" />
          <span>{t(`campaignParams.reason.${u.reason}`)}</span>
        </div>
      ))}
      {labels.map(label => (
        <label key={label} className="flex items-center gap-2 text-xs">
          <span className="font-mono text-ink-3 shrink-0 w-24 truncate" title={label}>
            {'{' + label + '}'}
          </span>
          <input
            type="text"
            value={values[label] ?? ''}
            onChange={e => onChange(label, e.target.value)}
            className="input-field flex-1 text-xs py-1"
            placeholder={t('common.valuePlaceholder')}
          />
        </label>
      ))}
    </div>
  )
}
