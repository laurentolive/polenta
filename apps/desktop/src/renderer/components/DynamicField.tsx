import type { SchemaField } from '@polenta/types'
import { RichTextField } from './RichTextField'

interface Props {
  field: SchemaField
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  repoPath?: string
}

export function DynamicField({ field, value, onChange, disabled, repoPath }: Props) {
  const label = field.label ?? field.name ?? ''

  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">
        {label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
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
