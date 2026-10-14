/**
 * TemplateForm — formulaire générique d'un modèle de la vue Suivi (GH74, specs/GH74.md §7) : un champ
 * par paramètre déclaré (`TemplateParamDef`). Le client non technique règle le modèle ici, sans voir
 * de code ; le code est généré côté main (`suivi:render-template`, enregistrement).
 */
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import type { FilterCondition, TemplateParamDef } from '@polenta/types'
import type { SuiviObjectTypeOption } from '@polenta/api-client'

export interface TemplateFormContext {
  /** Colonnes proposées (résultat de la requête, ou champs du type choisi pour « Liste filtrée »). */
  columns: string[]
  objectTypes?: SuiviObjectTypeOption[]
  campaigns?: { id: string; title: string }[]
}

interface Props extends TemplateFormContext {
  params: Omit<TemplateParamDef, never>[]
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
}

const OPERATORS: FilterCondition['operator'][] = ['=', '!=', '>', '<', 'contains', 'in']

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const typeKey = (o: { component: string; objectTypeRef: string }) => `${o.component}\u0000${o.objectTypeRef}`

/** Paramètre affiché ? (`dependsOn` renseigné ; mesure « nombre de lignes » : pas de colonne mesurée.) */
function visible(def: TemplateParamDef, value: Record<string, unknown>): boolean {
  if (def.kind === 'component') return false // réglé avec le type d'objet
  if (!def.dependsOn) return true
  const dep = value[def.dependsOn]
  if (def.dependsOn === 'measure') return !!dep && dep !== 'count'
  return dep !== undefined && dep !== null && dep !== '' && dep !== false
}

export function TemplateForm({ params, value, onChange, columns, objectTypes = [], campaigns = [] }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr'
  const set = (name: string, v: unknown) => {
    const next = { ...value }
    if (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) delete next[name]
    else next[name] = v
    onChange(next)
  }

  function field(def: TemplateParamDef) {
    const v = value[def.name]
    switch (def.kind) {
      case 'objectType': {
        const selected = objectTypes.find((o) => o.objectTypeRef === v && (!value.component || o.component === value.component))
        return (
          <select
            value={selected ? typeKey(selected) : ''}
            onChange={(e) => {
              const o = objectTypes.find((x) => typeKey(x) === e.target.value)
              const next = { ...value }
              delete next.conditions
              delete next.groupBy
              if (o) {
                next.objectTypeRef = o.objectTypeRef
                next.component = o.component
                delete next.category
              } else {
                delete next.objectTypeRef
                delete next.component
              }
              onChange(next)
            }}
            className="input-field flex-1 text-xs py-1"
          >
            <option value="">{t('dashboard.template.anyType')}</option>
            {objectTypes.map((o) => (
              <option key={typeKey(o)} value={typeKey(o)}>
                {o.category === 'campaign' ? t('queryPage.builder.campaignEntriesType', { label: o.label }) : o.label} — {o.component}
              </option>
            ))}
          </select>
        )
      }
      case 'conditions': {
        const conditions = (Array.isArray(v) ? v : []) as FilterCondition[]
        const update = (i: number, patch: Partial<FilterCondition>) => set(def.name, conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
        return (
          <div className="flex-1 space-y-1.5">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={c.field} onChange={(e) => update(i, { field: e.target.value })} className="input-field text-xs py-1 flex-1">
                  {[...new Set([c.field, ...columns])].map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
                <select value={c.operator} onChange={(e) => update(i, { operator: e.target.value as FilterCondition['operator'] })} className="input-field text-xs py-1 w-28 shrink-0">
                  {OPERATORS.map((op) => <option key={op} value={op}>{t(`dashboard.template.operators.${op}`)}</option>)}
                </select>
                <input
                  value={typeof c.value === 'string' ? c.value : String(c.value ?? '')}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={t('queryPage.builder.valuePlaceholder')}
                  className="input-field text-xs py-1 flex-1"
                />
                <button type="button" onClick={() => set(def.name, conditions.filter((_, j) => j !== i))} className="shrink-0 text-ink-3 hover:text-status-danger p-1" title={t('queryPage.builder.remove')}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set(def.name, [...conditions, { field: columns[0] ?? 'status', operator: '=', value: '' }])}
              className="flex items-center gap-1 text-xs text-status-info hover:underline"
            >
              <Plus size={12} /> {t('queryPage.builder.addCondition')}
            </button>
          </div>
        )
      }
      case 'combinator':
        return (
          <select value={String(v ?? 'AND')} onChange={(e) => set(def.name, e.target.value)} className="input-field text-xs py-1 w-24">
            <option value="AND">{t('queryPage.builder.and')}</option>
            <option value="OR">{t('queryPage.builder.or')}</option>
          </select>
        )
      case 'column':
        return (
          <select value={typeof v === 'string' ? v : ''} onChange={(e) => set(def.name, e.target.value || undefined)} className="input-field flex-1 text-xs py-1">
            <option value="">{t('dashboard.widgetModal.selectPlaceholder')}</option>
            {[...new Set([...(typeof v === 'string' && v ? [v] : []), ...columns])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )
      case 'columns':
        return (
          <div className="flex-1 flex flex-wrap gap-x-3 gap-y-1">
            {[...new Set([...asList(v), ...columns])].map((c) => (
              <label key={c} className="flex items-center gap-1 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={asList(v).includes(c)}
                  onChange={() => set(def.name, asList(v).includes(c) ? asList(v).filter((x) => x !== c) : [...asList(v), c])}
                />
                {c}
              </label>
            ))}
          </div>
        )
      case 'enum':
        return (
          <select value={v === undefined ? '' : String(v)} onChange={(e) => set(def.name, e.target.value || undefined)} className="input-field flex-1 text-xs py-1">
            <option value="">{t('dashboard.widgetModal.selectPlaceholder')}</option>
            {(def.values ?? []).map((o) => <option key={o.value} value={o.value}>{o.label[lang]}</option>)}
          </select>
        )
      case 'multiEnum':
      case 'campaigns': {
        const options = def.kind === 'campaigns'
          ? campaigns.map((c) => ({ value: c.id, label: `${c.id} — ${c.title}` }))
          : (def.values ?? []).map((o) => ({ value: o.value, label: o.label[lang] }))
        return (
          <div className="flex-1 flex flex-wrap gap-x-3 gap-y-1 max-h-28 overflow-y-auto">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-1 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={asList(v).includes(o.value)}
                  onChange={() => set(def.name, asList(v).includes(o.value) ? asList(v).filter((x) => x !== o.value) : [...asList(v), o.value])}
                />
                {o.label}
              </label>
            ))}
            {options.length === 0 && <span className="text-xs text-ink-3 italic">{t('dashboard.template.noOption')}</span>}
          </div>
        )
      }
      case 'boolean':
        return <input type="checkbox" checked={v === true} onChange={(e) => set(def.name, e.target.checked)} />
      case 'text':
      default:
        return (
          <input value={typeof v === 'string' ? v : v === undefined ? '' : String(v)} onChange={(e) => set(def.name, e.target.value)} className="input-field flex-1 text-xs py-1" />
        )
    }
  }

  return (
    <div className="space-y-2" data-testid="template-form">
      {params.filter((p) => visible(p, value)).map((def) => (
        <div key={def.name} className="flex items-start gap-2">
          <label className="text-xs text-ink-3 shrink-0 w-40 pt-1">
            {def.label[lang]}{def.required ? ' *' : ''}
          </label>
          {field(def)}
        </div>
      ))}
    </div>
  )
}
