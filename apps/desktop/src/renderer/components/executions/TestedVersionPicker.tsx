import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectableVersions } from '@polenta/types'
import type { TestedConfigChoice, TestedRepoOptions, TestedVersionOption } from '@polenta/types'

// GH202 — saisie de la version testée (specs/GH202.md §2) : version du repo de la campagne ou texte libre,
// structure repliable où l'on ne touche que ce qui diffère de la composition.

const OTHER = '__other__'

interface ValueProps {
  options: TestedVersionOption[]
  value: string
  onChange: (value: string) => void
  /** Absent : pas d'option vide (la composition s'applique tant que rien d'autre n'est saisi). */
  emptyLabel?: string
  testId: string
}

function VersionValue({ options, value, onChange, emptyLabel, testId }: ValueProps) {
  const { t } = useTranslation()
  const [other, setOther] = useState(false)
  const known = options.some(o => o.id === value)
  const isOther = other || (!!value && !known)
  return (
    <div className="flex items-center gap-2 min-w-0">
      <select
        className="input-field text-xs max-w-xs"
        value={isOther ? OTHER : value}
        data-testid={testId}
        onChange={e => {
          if (e.target.value === OTHER) { setOther(true); onChange('') }
          else { setOther(false); onChange(e.target.value) }
        }}
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.title} ({o.id}) · {t(`testedConfig.state.${o.state}`)}</option>
        ))}
        <option value={OTHER}>{t('testedConfig.other')}</option>
      </select>
      {isOther && (
        <input
          className="input-field text-xs flex-1 min-w-0"
          value={known ? '' : value}
          placeholder={t('testedConfig.otherPlaceholder')}
          data-testid={`${testId}-text`}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

interface RowsProps {
  repo: TestedRepoOptions
  version: TestedVersionOption | undefined
  prefix: string
  overrides: Record<string, string>
  onOverride: (path: string, value: string | undefined) => void
  depth: number
}

function ComponentRows({ repo, version, prefix, overrides, onOverride, depth }: RowsProps) {
  const { t } = useTranslation()
  return (
    <>
      {repo.dependencies.map(dep => {
        const path = prefix ? `${prefix}/${dep.name}` : dep.name
        const expected = version?.components?.[dep.name]
        const override = overrides[path]
        const value = override ?? expected ?? ''
        const selected = dep.versions.find(v => v.id === value)
        const deviates = override !== undefined
        const options = selectableVersions(dep)
        // Une composition peut citer une version abandonnée : elle reste affichée.
        const withExpected = selected && !options.includes(selected) ? [selected, ...options] : options
        return (
          <div key={path}>
            <div
              className={`flex items-center gap-2 px-2 py-1 rounded ${deviates ? 'bg-status-warning-bg' : ''}`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              data-testid={`tested-component-${path}`}
              data-deviates={deviates || undefined}
            >
              <span className="text-xs text-ink w-40 shrink-0 truncate" title={dep.label}>{dep.label}</span>
              <VersionValue
                options={withExpected}
                value={value}
                {...(!expected && { emptyLabel: t('testedConfig.none') })}
                testId={`tested-component-select-${path}`}
                onChange={v => onOverride(path, !v.trim() || v === expected ? undefined : v)}
              />
              {deviates && <span className="text-[10px] text-status-warning shrink-0">{t('testedConfig.deviation')}</span>}
            </div>
            <ComponentRows repo={dep} version={selected} prefix={path} overrides={overrides} onOverride={onOverride} depth={depth + 1} />
          </div>
        )
      })}
    </>
  )
}

interface Props {
  options: TestedRepoOptions
  value: TestedConfigChoice
  onChange: (value: TestedConfigChoice) => void
  /** Saisie obligatoire manquante, après une tentative d'enregistrement. */
  missing: boolean
}

export function TestedVersionPicker({ options, value, onChange, missing }: Props) {
  const { t } = useTranslation()
  const overrides = value.components ?? {}
  const count = Object.keys(overrides).length
  const version = options.versions.find(v => v.id === value.version)
  const setOverride = (path: string, v: string | undefined) => {
    const next = { ...overrides }
    if (v === undefined) delete next[path]
    else next[path] = v
    onChange({ version: value.version, ...(Object.keys(next).length > 0 && { components: next }) })
  }
  return (
    <div data-testid="tested-version">
      <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('testedConfig.title')} *</p>
      <div className={`border rounded px-3 py-2 ${missing ? 'border-status-danger-border' : 'border-edge'}`}>
        <VersionValue
          options={selectableVersions(options)}
          value={value.version}
          emptyLabel={t('testedConfig.choose')}
          testId="tested-version-select"
          onChange={v => onChange({ ...value, version: v })}
        />
        {missing && <p className="text-xs text-status-danger mt-1" data-testid="tested-version-missing">{t('testedConfig.required')}</p>}
        {options.dependencies.length > 0 && (
          <details className="mt-2" data-testid="tested-structure">
            <summary className="text-xs text-ink-2 cursor-pointer select-none">
              {t('testedConfig.structure')}{count > 0 ? ` · ${t('testedConfig.deviationCount', { count })}` : ''}
            </summary>
            <div className="mt-1 space-y-0.5">
              <ComponentRows repo={options} version={version} prefix="" overrides={overrides} onOverride={setOverride} depth={0} />
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
