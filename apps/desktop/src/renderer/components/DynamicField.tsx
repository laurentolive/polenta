import type { SchemaField } from '@polenta/types'
import { RichTextField } from './RichTextField'
import { MultiEnumCheckboxes } from './MultiEnumCheckboxes'

interface Props {
  field: SchemaField
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  repoPath?: string
  /** Catalogue de rôles du repo courant (`schema.roles`), pour le champ `multi_enum`
   *  nommé `roles` uniquement — même règle que EditView.tsx (T110 sprint 3). */
  interfaceRoles?: string[]
}

export function DynamicField({ field, value, onChange, disabled, repoPath, interfaceRoles }: Props) {
  const label = field.label ?? field.name ?? ''

  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">
        {label}
        {field.required && <span className="text-status-danger ml-1">*</span>}
      </label>
      {field.type === 'richtext' ? (
        <RichTextField
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          repoPath={repoPath}
        />
      ) : field.type === 'enum' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="input-field w-full"
        >
          {!field.required && <option value="">—</option>}
          {(field.values ?? []).map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          rows={3}
          className="input-field w-full resize-none"
        />
      ) : field.type === 'boolean' ? (
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={e => onChange(e.target.checked ? 'true' : 'false')}
          disabled={disabled}
          className="h-4 w-4 accent-ink"
        />
      ) : field.type === 'multi_enum' ? (
        <MultiEnumCheckboxes
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          interfaceRoles={interfaceRoles}
        />
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder ?? ''}
          className="input-field w-full"
        />
      )}
    </div>
  )
}
