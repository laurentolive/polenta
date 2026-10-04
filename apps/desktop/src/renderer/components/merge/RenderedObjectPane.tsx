import { forwardRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import type { ObjectTypeDefinition, SchemaField, TestStep } from '@polenta/types'
import { fragmentValue, unitValue, type Side } from '@polenta/merge-core'
import { DynamicField } from '../DynamicField'
import { RichTextViewer } from '../RichTextViewer'
import { StepsTable, type StepDraft } from '../StepsTable'

/**
 * GH37 sprint 2 — mode « Rendu » d'un objet typé (exigence, test) : l'objet affiché comme dans
 * l'outil, à partir de sa valeur YAML et de son type (`schema.yaml`).
 *
 * - lecture seule (mes modifications / ancêtre / destination) : `changed` surligne les unités que
 *   ce côté a modifiées depuis l'ancêtre ;
 * - sortie : champs éditables (mêmes widgets que l'éditeur), et pour chaque unité encore en
 *   conflit une carte « gauche / droite » rendue avec ses deux boutons.
 *
 * Chaque unité porte `data-unit` : c'est l'ancre du défilement synchronisé.
 */

type Obj = Record<string, unknown>

interface Props {
  value: Obj
  typeDef?: ObjectTypeDefinition
  repoPath: string
  tone?: Side
  /** Unités modifiées par ce côté depuis l'ancêtre commun (surlignées). */
  changed?: Set<string>
  /** Sortie : unités encore en conflit, avec leurs fragments gauche/droite. */
  conflicts?: Map<string, { left: string; right: string }>
  onResolve?: (unit: string, side: Side) => void
  /** Sortie : `undefined` = lecture seule. */
  onChangeUnit?: (unit: string, value: unknown) => void
  onScroll?: () => void
}

/** Root units rendered by dedicated widgets; any other root unit goes to "Autres propriétés". */
const SPECIAL_ROOT = new Set(['id', 'title', 'status', 'fields', 'preconditions', 'steps', 'postconditions'])

export const RenderedObjectPane = forwardRef<HTMLDivElement, Props>(function RenderedObjectPane(
  { value, typeDef, repoPath, tone, changed, conflicts, onResolve, onChangeUnit, onScroll },
  ref,
) {
  const { t } = useTranslation()
  const editable = !!onChangeUnit
  const fields = (typeDef?.fields ?? []) as SchemaField[]
  const fieldNames = new Set(fields.map(f => f.name))
  const valueFields = value.fields && typeof value.fields === 'object' ? Object.keys(value.fields as Obj) : []
  const conflictKeys = [...(conflicts?.keys() ?? [])]
  // Schema fields first (schema order), then fields only present in the data or in a conflict.
  const extraFields = [...new Set([...valueFields, ...conflictKeys.filter(k => k.startsWith('fields.')).map(k => k.slice(7))])]
    .filter(n => !fieldNames.has(n))
  const otherRoots = [...new Set([...Object.keys(value), ...conflictKeys.filter(k => !k.startsWith('fields.'))])]
    .filter(k => !SPECIAL_ROOT.has(k))
  const isTest = typeDef?.category === 'test' || 'steps' in value || conflicts?.has('steps')

  const unit = (key: string, label: string, body: ReactNode) => {
    const conflict = conflicts?.get(key)
    const highlighted = changed?.has(key)
    return (
      <section
        key={key}
        data-unit={key}
        className={`px-3 py-2 rounded ${highlighted ? (tone === 'left' ? 'bg-status-info-bg' : 'bg-status-success-bg') : ''}`}
      >
        <p className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">
          {label}
          {fieldOf(key, fields)?.required && <span className="text-status-danger ml-1">*</span>}
        </p>
        {/* The unit title above already names the field: DynamicField's own label is hidden. */}
        {conflict
          ? <ConflictCard unit={key} conflict={conflict} field={fieldOf(key, fields)} repoPath={repoPath} onResolve={onResolve} />
          : <div className="[&>div>label:first-child]:hidden">{body}</div>}
      </section>
    )
  }

  const edit = (key: string) => (v: unknown) => onChangeUnit?.(key, v)

  return (
    <div ref={ref} onScroll={onScroll} className="relative h-full overflow-auto py-2 space-y-1">
      {unit('title', t('mergeResolve.rendered.title'), editable
        ? <input className="input-field w-full" value={String(value.title ?? '')} onChange={e => edit('title')(e.target.value)} />
        : <p className="text-sm font-semibold text-ink">{String(value.title ?? '')}</p>)}

      {unit('status', t('mergeResolve.rendered.status'), editable && typeDef?.statuses?.length
        ? (
          <select className="input-field" value={String(value.status ?? '')} onChange={e => edit('status')(e.target.value)}>
            {typeDef.statuses.map(s => <option key={s.name} value={s.name}>{s.label ?? s.name}</option>)}
          </select>
        )
        : <p className="text-sm text-ink">{statusLabel(typeDef, value.status)}</p>)}

      {isTest && unit('preconditions', t('mergeResolve.rendered.preconditions'),
        richtext(value.preconditions, repoPath, editable ? edit('preconditions') : undefined))}

      {fields.map(f => unit(`fields.${f.name}`, f.label ?? f.name, fieldBody(f, unitValue(value, `fields.${f.name}`), repoPath, editable ? edit(`fields.${f.name}`) : undefined)))}
      {extraFields.map(n => unit(`fields.${n}`, n, <RawValue value={unitValue(value, `fields.${n}`)} />))}

      {isTest && unit('steps', t('mergeResolve.rendered.steps'), (
        <StepsTable
          steps={toDrafts(value.steps)}
          onChange={editable ? s => edit('steps')(fromDrafts(s, value.steps)) : () => {}}
          disabled={!editable}
          repoPath={repoPath}
        />
      ))}
      {isTest && unit('postconditions', t('mergeResolve.rendered.postconditions'),
        richtext(value.postconditions, repoPath, editable ? edit('postconditions') : undefined))}

      {otherRoots.length > 0 && (
        <div className="pt-2 mt-2 border-t border-edge-subtle">
          <p className="px-3 text-[11px] uppercase tracking-wide text-ink-3">{t('mergeResolve.rendered.other')}</p>
          {otherRoots.map(k => unit(k, k, <RawValue value={value[k]} />))}
        </div>
      )}
    </div>
  )
})

function fieldOf(unit: string, fields: SchemaField[]): SchemaField | undefined {
  return unit.startsWith('fields.') ? fields.find(f => f.name === unit.slice(7)) : undefined
}

function statusLabel(typeDef: ObjectTypeDefinition | undefined, status: unknown): string {
  return typeDef?.statuses?.find(s => s.name === status)?.label ?? String(status ?? '')
}

function richtext(v: unknown, repoPath: string, onChange?: (v: unknown) => void): ReactNode {
  const text = typeof v === 'string' ? v : ''
  if (onChange) {
    return <DynamicField field={{ name: '', label: '', type: 'richtext' } as SchemaField} value={text} onChange={onChange} repoPath={repoPath} />
  }
  return text ? <RichTextViewer value={text} repoPath={repoPath} /> : <Empty />
}

/** Same widgets as the object editor; the value keeps its YAML type (number, boolean). */
function fieldBody(field: SchemaField, v: unknown, repoPath: string, onChange?: (v: unknown) => void): ReactNode {
  if (!onChange) return <FieldValue field={field} value={v} repoPath={repoPath} />
  const asString = v === undefined || v === null ? '' : String(v)
  return (
    <DynamicField
      field={{ ...field, label: '' }}
      value={asString}
      repoPath={repoPath}
      onChange={s => onChange(toFieldValue(field, s))}
    />
  )
}

/** Converts a widget string back to the field's YAML value — by the schema type only: a `text`
 *  field that happens to hold `42` stays a string as soon as it is edited. */
function toFieldValue(field: SchemaField, s: string): unknown {
  if (s === '' && !field.required) return undefined
  if (field.type === 'number') {
    const n = Number(s)
    return s === '' || Number.isNaN(n) ? s : n
  }
  if (field.type === 'boolean') return s === 'true'
  return s
}

function FieldValue({ field, value, repoPath }: { field?: SchemaField; value: unknown; repoPath: string }) {
  if (value === undefined || value === null || value === '') return <Empty />
  if (field?.type === 'richtext' && typeof value === 'string') return <RichTextViewer value={value} repoPath={repoPath} />
  if (typeof value === 'object') return <RawValue value={value} />
  return <p className="text-sm text-ink whitespace-pre-wrap">{String(value)}</p>
}

function RawValue({ value }: { value: unknown }) {
  if (value === undefined) return <Empty />
  return <pre className="text-xs text-ink-2 font-mono whitespace-pre-wrap">{yaml.dump(value, { lineWidth: 120 }).trimEnd()}</pre>
}

function Empty() {
  const { t } = useTranslation()
  return <p className="text-xs text-ink-3 italic">{t('mergeResolve.rendered.empty')}</p>
}

function ConflictCard({ unit, conflict, field, repoPath, onResolve }: {
  unit: string
  conflict: { left: string; right: string }
  field?: SchemaField
  repoPath: string
  onResolve?: (unit: string, side: Side) => void
}) {
  const { t } = useTranslation()
  const side = (s: Side) => {
    const fragment = s === 'left' ? conflict.left : conflict.right
    const v = fragmentValue(fragment)
    const absent = fragment.trim() === ''
    return (
      <div className={`flex-1 min-w-0 rounded border p-2 ${s === 'left' ? 'border-status-info-border bg-status-info-bg' : 'border-status-success-border bg-status-success-bg'}`}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-3">{s === 'left' ? t('mergeResolve.rendered.leftValue') : t('mergeResolve.rendered.rightValue')}</span>
          <button type="button" className="btn-secondary-sm" onClick={() => onResolve?.(unit, s)}>
            {s === 'left' ? t('mergeResolve.takeLeft') : t('mergeResolve.takeRight')}
          </button>
        </div>
        {absent
          ? <p className="text-xs text-ink-3 italic">{t('mergeResolve.rendered.removedOnSide')}</p>
          : unit === 'steps'
            ? <StepsTable steps={toDrafts(v)} onChange={() => {}} disabled repoPath={repoPath} />
            : unit === 'preconditions' || unit === 'postconditions'
              ? <FieldValue field={{ name: unit, type: 'richtext' } as SchemaField} value={v} repoPath={repoPath} />
              : <FieldValue field={field} value={v} repoPath={repoPath} />}
      </div>
    )
  }
  return (
    <div className="rounded border border-status-warning-border p-2 bg-status-warning-bg/40">
      <p className="text-xs text-status-warning mb-2">{t('mergeResolve.rendered.conflict')}</p>
      <div className="flex gap-2">{side('left')}{side('right')}</div>
    </div>
  )
}

function toDrafts(steps: unknown): StepDraft[] {
  if (!Array.isArray(steps)) return []
  return steps.map(s => ({ action: String((s as TestStep)?.action ?? ''), expectedResult: String((s as TestStep)?.expectedResult ?? '') }))
}

/**
 * Back to `TestStep[]`. The table does not show `notes`: they follow the step they belong to —
 * matched by content (a reordered or surviving step keeps its notes), and by position only for a
 * step edited in place (same count, its former occupant matched nothing). Never moved onto
 * another step; dropped otherwise, like the other step editors do.
 */
function fromDrafts(drafts: StepDraft[], previous: unknown): TestStep[] {
  const prev = Array.isArray(previous) ? (previous as TestStep[]) : []
  const used = new Set<number>()
  const byContent = drafts.map(d => {
    const i = prev.findIndex((p, j) => !used.has(j) && p.action === d.action && p.expectedResult === d.expectedResult)
    if (i >= 0) used.add(i)
    return i
  })
  return drafts.map((d, i) => {
    let source = byContent[i]
    if (source < 0 && drafts.length === prev.length && !used.has(i)) source = i
    return { order: i + 1, action: d.action, expectedResult: d.expectedResult, notes: source >= 0 ? prev[source]?.notes ?? null : null }
  })
}
