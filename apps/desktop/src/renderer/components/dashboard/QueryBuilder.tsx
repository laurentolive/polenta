/**
 * QueryBuilder — guided query builder for the Requêtes view (T77 sprint 1).
 *
 * Lets the user pick an object type (from schema.yaml, requirement/test categories
 * only — the query-engine dataset doesn't include campaigns), add conditions on its
 * fields, combine them with AND/OR, and optionally group by a field for aggregate
 * counts. Doesn't write raw SQL — query-engine.service.ts translates this config.
 *
 * The "Type d'objet" list spans every component of the workspace (not just the
 * current/root repo, T93) — the query-engine dataset already aggregates all of them
 * (`buildDataset()`), but each component names its own local schema node "root", so
 * `objectTypeRef` alone ("root::exigence-fw") is not unique across components: the
 * `component` tag (mount name) disambiguates which one a given selection belongs to.
 */

import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import type { BuilderCondition, BuilderConfig, ProjectSchema, SchemaField } from '@polenta/types'

interface ComponentNode {
  name: string
  repoPath: string
}

interface Props {
  flatNodes: ComponentNode[]
  schemasByRepoPath: Map<string, ProjectSchema>
  /** repoPath of the currently open project — its own types get no `component` tag,
   *  matching the query-engine's existing (unambiguous, unchanged) root-repo scope. */
  selfRepoPath: string
  value: BuilderConfig
  onChange: (config: BuilderConfig) => void
}

interface QueryableType {
  ref: string
  /** Mount name of the owning component — undefined for the current/root repo. */
  component: string | undefined
  label: string
  category: 'requirement' | 'test'
  fields: SchemaField[]
}

/** Encodes {component, ref} into a single `<select>` option value — `ref` alone
 *  collides across components (each names its own local node "root"). */
function encodeTypeKey(component: string | undefined, ref: string): string {
  return `${component ?? ''}|${ref}`
}

function decodeTypeKey(key: string): { component: string | undefined; ref: string } {
  const sep = key.indexOf('|')
  if (sep < 0) return { component: undefined, ref: key }
  const component = key.slice(0, sep)
  return { component: component || undefined, ref: key.slice(sep + 1) }
}

/** T111 — noms/types techniques statiques ; labels résolus via t() dans le composant
 *  (convention module-scope : jamais de littéral traduit ici, cf. labelKeyForSystem). */
const SYSTEM_FIELD_DEFS: { name: string; labelKey: string; type: SchemaField['type'] }[] = [
  { name: 'id', labelKey: 'system.wordView.colId', type: 'text' },
  { name: 'title', labelKey: 'requirementsPage.titleLabel', type: 'text' },
  { name: 'status', labelKey: 'system.wordView.colStatus', type: 'text' },
  { name: 'component', labelKey: 'sidebar.system.component', type: 'text' },
  { name: 'createdAt', labelKey: 'system.fieldConfig.colCreatedAt', type: 'date' },
  { name: 'createdBy', labelKey: 'queryPage.builder.colCreatedBy', type: 'text' },
  { name: 'updatedAt', labelKey: 'system.fieldConfig.colUpdatedAt', type: 'date' },
  { name: 'updatedBy', labelKey: 'queryPage.builder.colUpdatedBy', type: 'text' },
]

const OPERATORS: { value: BuilderCondition['operator']; labelKey: string | null; symbol: string | null }[] = [
  { value: '=', labelKey: null, symbol: '=' },
  { value: '!=', labelKey: null, symbol: '≠' },
  { value: '>', labelKey: null, symbol: '>' },
  { value: '<', labelKey: null, symbol: '<' },
  { value: 'contains', labelKey: 'queryPage.builder.opContains', symbol: null },
  { value: 'in', labelKey: 'queryPage.builder.opIn', symbol: null },
]

export function getQueryableTypes(
  flatNodes: ComponentNode[],
  schemasByRepoPath: Map<string, ProjectSchema>,
  selfRepoPath: string,
): QueryableType[] {
  const result: QueryableType[] = []
  for (const node of flatNodes) {
    const schema = schemasByRepoPath.get(node.repoPath)
    if (!schema) continue
    const component = node.repoPath === selfRepoPath ? undefined : node.name
    const componentLabel = schema.nodes[0]?.label ?? node.name
    for (const localNode of schema.nodes) {
      for (const ot of localNode.objectTypes ?? []) {
        if (ot.category !== 'requirement' && ot.category !== 'test') continue
        result.push({
          ref: `${localNode.name}::${ot.name}`,
          component,
          label: component ? `${componentLabel} / ${ot.label ?? ot.name}` : (ot.label ?? ot.name),
          category: ot.category,
          fields: ot.fields ?? [],
        })
      }
    }
  }
  return result
}

function fieldsForType(types: QueryableType[], ref: string, component: string | undefined, systemFields: SchemaField[]): SchemaField[] {
  const type = types.find((t) => t.ref === ref && t.component === component)
  const systemNames = new Set(systemFields.map((f) => f.name))
  // Un champ custom qui reprend le nom d'un champ système (ex: "status") est masqué ici :
  // le dataset du moteur de requête fait toujours gagner le champ système en cas de
  // collision (cf. flattenRequirement/flattenTestCase dans query-engine.service.ts), donc
  // l'afficher créerait une option qui ne correspondrait jamais à la valeur custom réelle.
  const customFields = (type?.fields ?? []).filter((f) => !systemNames.has(f.name))
  return [...systemFields, ...customFields]
}

export function QueryBuilder({ flatNodes, schemasByRepoPath, selfRepoPath, value, onChange }: Props) {
  const { t } = useTranslation()
  const systemFields: SchemaField[] = SYSTEM_FIELD_DEFS.map((f) => ({ name: f.name, label: t(f.labelKey), type: f.type }))
  const operators = OPERATORS.map((op) => ({ value: op.value, label: op.symbol ?? t(op.labelKey!) }))
  const types = getQueryableTypes(flatNodes, schemasByRepoPath, selfRepoPath)
  const fields = fieldsForType(types, value.objectTypeRef, value.component, systemFields)
  const selectedKey = value.objectTypeRef ? encodeTypeKey(value.component, value.objectTypeRef) : ''

  function updateCondition(idx: number, patch: Partial<BuilderCondition>) {
    const conditions = value.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    onChange({ ...value, conditions })
  }

  function addCondition() {
    const defaultField = fields[0]?.name ?? 'status'
    onChange({ ...value, conditions: [...value.conditions, { field: defaultField, operator: '=', value: '' }] })
  }

  function removeCondition(idx: number) {
    onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== idx) })
  }

  function toggleGroupBy(fieldName: string) {
    const current = value.groupBy ?? []
    const groupBy = current.includes(fieldName)
      ? current.filter((f) => f !== fieldName)
      : [...current, fieldName]
    onChange({ ...value, groupBy: groupBy.length ? groupBy : undefined })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-3 shrink-0 w-24">{t('queryPage.builder.objectTypeLabel')}</label>
        <select
          value={selectedKey}
          onChange={(e) => {
            const { component, ref } = decodeTypeKey(e.target.value)
            onChange({ ...value, objectTypeRef: ref, component, conditions: [], groupBy: undefined })
          }}
          className="input-field flex-1 text-xs py-1"
        >
          {types.length === 0 ? (
            <option value="">{t('queryPage.builder.noTypeConfigured')}</option>
          ) : (
            <>
              <option value="">{t('dashboard.widgetModal.selectPlaceholder')}</option>
              {types.map((qt) => (
                <option key={encodeTypeKey(qt.component, qt.ref)} value={encodeTypeKey(qt.component, qt.ref)}>{qt.label}</option>
              ))}
            </>
          )}
        </select>
      </div>

      {value.objectTypeRef && (
        <>
          <div className="space-y-2">
            {value.conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <select
                    value={value.combinator}
                    onChange={(e) => onChange({ ...value, combinator: e.target.value as 'AND' | 'OR' })}
                    className="input-field text-xs py-1 w-16 shrink-0"
                  >
                    <option value="AND">{t('queryPage.builder.and')}</option>
                    <option value="OR">{t('queryPage.builder.or')}</option>
                  </select>
                )}
                {idx === 0 && <span className="w-16 shrink-0 text-xs text-ink-3">{t('queryPage.builder.if')}</span>}
                <select
                  value={cond.field}
                  onChange={(e) => updateCondition(idx, { field: e.target.value })}
                  className="input-field text-xs py-1 flex-1"
                >
                  {fields.map((f) => (
                    <option key={f.name} value={f.name}>{f.label ?? f.name}</option>
                  ))}
                </select>
                <select
                  value={cond.operator}
                  onChange={(e) => updateCondition(idx, { operator: e.target.value as BuilderCondition['operator'] })}
                  className="input-field text-xs py-1 w-32 shrink-0"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.symbol ?? t(op.labelKey!)}</option>
                  ))}
                </select>
                <input
                  value={typeof cond.value === 'string' ? cond.value : String(cond.value ?? '')}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  placeholder={t('queryPage.builder.valuePlaceholder')}
                  className="input-field text-xs py-1 flex-1"
                />
                <button type="button" onClick={() => removeCondition(idx)} className="shrink-0 text-ink-3 hover:text-status-danger p-1" title={t('queryPage.builder.remove')}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addCondition}
            className="flex items-center gap-1 text-xs text-status-info hover:underline"
          >
            <Plus size={12} /> {t('queryPage.builder.addCondition')}
          </button>

          <div className="flex items-start gap-2 pt-1 border-t border-edge-subtle">
            <label className="text-xs text-ink-3 shrink-0 w-24 pt-1">{t('queryPage.builder.groupByLabel')}</label>
            <div className="flex-1 flex flex-wrap gap-2">
              {fields.map((f) => (
                <label key={f.name} className="flex items-center gap-1 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={(value.groupBy ?? []).includes(f.name)}
                    onChange={() => toggleGroupBy(f.name)}
                  />
                  {f.label ?? f.name}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
