import type { SchemaField } from '@polenta/types'
import { parseMultiEnumValue, serializeMultiEnumValue, resolveMultiEnumOptions } from '@polenta/types'
import { useTranslation } from 'react-i18next'

interface Props {
  field: SchemaField
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Catalogue de rôles du repo courant (`schema.roles`), pour le champ `multi_enum`
   *  nommé `roles` uniquement (T110 sprint 3). `undefined`/vide → fallback sur `field.values`. */
  interfaceRoles?: string[]
}

export function MultiEnumCheckboxes({ field, value, onChange, disabled, interfaceRoles }: Props) {
  const { t } = useTranslation()
  const opts = resolveMultiEnumOptions(field, interfaceRoles)
  const selected = parseMultiEnumValue(value)
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]
    onChange(serializeMultiEnumValue(next))
  }
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map(v => (
        <label key={v} className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(v)}
            onChange={() => toggle(v)}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-ink"
          />
          {v}
        </label>
      ))}
      {opts.length === 0 && (
        <span className="text-ink-3 text-xs italic">{t('system.editView.noConfiguredValue')}</span>
      )}
    </div>
  )
}
