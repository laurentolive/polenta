import { useEffect, useState, type ReactNode } from 'react'
import type { SchemaField, SchemaStatus, SchemaFieldType, ObjectCategory, ObjectTypeDefinition } from '@polenta/types'

// ── Editable state types ──────────────────────────────────────────────────────
// Shared between routes/schema.tsx (Liens/Interfaces tabs) and the Structure
// tab's ElementConfigModal, so both edit object types with identical fields.

export interface EditableField {
  name: string; label: string; type: SchemaFieldType
  values: string; required: boolean; default: string; placeholder: string
}

export interface EditableStatus {
  name: string; label: string; color: string; isApproval: boolean; isTerminal: boolean
}

export interface EditableObjectType {
  name: string; label: string; color: string; prefix: string; category: ObjectCategory
  fields: EditableField[]; statuses: EditableStatus[]
}

// ── Converters ────────────────────────────────────────────────────────────────

export function fieldToEditable(f: SchemaField): EditableField {
  return {
    name: f.name, label: f.label ?? '', type: f.type,
    values: (f.values ?? []).join(', '), required: f.required ?? false,
    default: f.default !== undefined ? String(f.default) : '', placeholder: f.placeholder ?? '',
  }
}

export function editableToField(f: EditableField): SchemaField {
  const result: SchemaField = { name: f.name, type: f.type }
  if (f.label) result.label = f.label
  if (f.type === 'enum' || f.type === 'multi_enum') result.values = f.values.split(',').map(v => v.trim()).filter(Boolean)
  if (f.required) result.required = true
  if (f.default) result.default = f.default
  if (f.placeholder) result.placeholder = f.placeholder
  return result
}

export function statusToEditable(s: SchemaStatus): EditableStatus {
  return { name: s.name, label: s.label ?? '', color: s.color ?? '', isApproval: s.isApproval ?? false, isTerminal: s.isTerminal ?? false }
}

export function editableToStatus(s: EditableStatus): SchemaStatus {
  const result: SchemaStatus = { name: s.name }
  if (s.label) result.label = s.label
  if (s.color) result.color = s.color
  if (s.isApproval) result.isApproval = true
  if (s.isTerminal) result.isTerminal = true
  return result
}

export function objTypeToEditable(t: ObjectTypeDefinition): EditableObjectType {
  return {
    name: t.name, label: t.label ?? '', color: t.color ?? '', prefix: t.prefix ?? '',
    category: t.category,
    fields: t.fields.map(fieldToEditable),
    statuses: (t.statuses ?? []).map(statusToEditable),
  }
}

export function editableToObjType(t: EditableObjectType): ObjectTypeDefinition {
  const result: ObjectTypeDefinition = { name: t.name, category: t.category, fields: t.fields.map(editableToField) }
  if (t.label) result.label = t.label
  if (t.color) result.color = t.color
  if (t.prefix) result.prefix = t.prefix
  if (t.statuses.length > 0) result.statuses = t.statuses.map(editableToStatus)
  return result
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const FIELD_TYPES: SchemaFieldType[] = ['text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user']

export const DEFAULT_REQ_STATUSES: EditableStatus[] = [
  { name: 'draft', label: 'Brouillon', color: '', isApproval: false, isTerminal: false },
  { name: 'review', label: 'En review', color: '', isApproval: false, isTerminal: false },
  { name: 'approved', label: 'Approuvé', color: '', isApproval: true, isTerminal: false },
  { name: 'obsolete', label: 'Obsolète', color: '', isApproval: false, isTerminal: true },
]

export const DEFAULT_TEST_STATUSES: EditableStatus[] = [
  { name: 'draft', label: 'Brouillon', color: '', isApproval: false, isTerminal: false },
  { name: 'review', label: 'En review', color: '', isApproval: false, isTerminal: false },
  { name: 'approved', label: 'Approuvé', color: '', isApproval: true, isTerminal: false },
]

export const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  requirement: 'Exigence',
  test: 'Test',
  campaign: 'Campagne',
}

// ── Factories ─────────────────────────────────────────────────────────────────

export function emptyField(): EditableField {
  return { name: '', label: '', type: 'text', values: '', required: false, default: '', placeholder: '' }
}

export function emptyStatus(): EditableStatus {
  return { name: '', label: '', color: '', isApproval: false, isTerminal: false }
}

export function emptyObjType(category: ObjectCategory): EditableObjectType {
  return {
    name: '', label: '', color: '', prefix: '', category,
    fields: [],
    statuses: category === 'requirement' ? [...DEFAULT_REQ_STATUSES]
      : category === 'test' ? [...DEFAULT_TEST_STATUSES]
      : [],
  }
}

// ── Array helpers ─────────────────────────────────────────────────────────────

export function moveUp<T>(arr: T[], i: number): T[] {
  if (i === 0) return arr
  const next = [...arr];[next[i - 1], next[i]] = [next[i], next[i - 1]]; return next
}

export function moveDown<T>(arr: T[], i: number): T[] {
  if (i === arr.length - 1) return arr
  const next = [...arr];[next[i], next[i + 1]] = [next[i + 1], next[i]]; return next
}

// ── Shared styles ──────────────────────────────────────────────────────────────

export const cellInput = 'w-full px-1 py-0.5 text-xs border-0 focus:outline-none bg-transparent text-ink'
export const selectCellInput = 'w-full px-1 py-0.5 text-xs border-0 focus:outline-none bg-surface text-ink'
export const thClass = 'border border-edge px-2 py-1 text-left font-medium text-ink-2 bg-hover'
export const tdClass = 'border border-edge px-1 py-0.5 bg-surface'

// ── ConfirmDelete ─────────────────────────────────────────────────────────────

export function ConfirmDelete({ onConfirm, className, label, disabled }: {
  onConfirm: () => void; className?: string; label?: ReactNode; disabled?: boolean
}) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!pending) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPending(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pending])

  return (
    <>
      <button type="button" onClick={() => setPending(true)} disabled={disabled} className={className ?? 'px-1 text-red-400 hover:text-red-600'}>{label ?? '×'}</button>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPending(false)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">Supprimer cet élément ?</h2>
            <p className="text-xs text-ink-2 mb-5">Cette action est irréversible.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPending(false)}
                className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
                Annuler
              </button>
              <button type="button" onClick={() => { onConfirm(); setPending(false) }} autoFocus
                className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── CancelConfirmModal ────────────────────────────────────────────────────────

export function CancelConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">Annuler les modifications ?</h2>
        <p className="text-xs text-ink-2 mb-5">Les modifications seront perdues. Êtes-vous sûr ?</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
            Non
          </button>
          <button type="button" onClick={onConfirm} autoFocus
            className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors">
            Oui, annuler
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FieldsTable ───────────────────────────────────────────────────────────────

export function FieldsTable({ fields, onChange }: { fields: EditableField[]; onChange: (f: EditableField[]) => void }) {
  const set = (i: number, patch: Partial<EditableField>) => {
    const next = [...fields]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  return (
    <div className="mt-3">
      <p className="section-label mb-1">Champs</p>
      {fields.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>Nom</th>
              <th className={thClass}>Label</th>
              <th className={thClass}>Type</th>
              <th className={thClass}>Valeurs (enum)</th>
              <th className={`${thClass} text-center`}>Req.</th>
              <th className={thClass}>Défaut</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="hover:bg-hover">
                <td className={tdClass}><input value={f.name} onChange={e => set(i, { name: e.target.value })} className={`${cellInput} font-mono`} placeholder="nom" /></td>
                <td className={tdClass}><input value={f.label} onChange={e => set(i, { label: e.target.value })} className={cellInput} placeholder="Label" /></td>
                <td className={tdClass}>
                  <select value={f.type} onChange={e => set(i, { type: e.target.value as SchemaFieldType })} className={`${selectCellInput} cursor-pointer`}>
                    {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className={tdClass}><input value={f.values} onChange={e => set(i, { values: e.target.value })} disabled={f.type !== 'enum' && f.type !== 'multi_enum'} className={`${cellInput} disabled:opacity-30`} placeholder="a, b, c" /></td>
                <td className={`${tdClass} text-center`}><input type="checkbox" checked={f.required} onChange={e => set(i, { required: e.target.checked })} className="h-3 w-3 accent-ink" /></td>
                <td className={tdClass}><input value={f.default} onChange={e => set(i, { default: e.target.value })} className={cellInput} placeholder="—" /></td>
                <td className={tdClass}>
                  <div className="flex gap-0.5 justify-end">
                    <button type="button" onClick={() => onChange(moveUp(fields, i))} disabled={i === 0} className="px-1 text-ink-3 hover:text-ink disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => onChange(moveDown(fields, i))} disabled={i === fields.length - 1} className="px-1 text-ink-3 hover:text-ink disabled:opacity-30">↓</button>
                    <ConfirmDelete onConfirm={() => onChange(fields.filter((_, j) => j !== i))} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => onChange([...fields, emptyField()])} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Ajouter un champ</button>
    </div>
  )
}

// ── StatusesTable ─────────────────────────────────────────────────────────────

export function StatusesTable({ statuses, onChange }: { statuses: EditableStatus[]; onChange: (s: EditableStatus[]) => void }) {
  const set = (i: number, patch: Partial<EditableStatus>) => {
    const next = [...statuses]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  return (
    <div className="mt-3">
      <p className="section-label mb-1">Statuts</p>
      {statuses.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>Nom</th>
              <th className={thClass}>Label</th>
              <th className={thClass}>Couleur</th>
              <th className={`${thClass} text-center`}>Approbation</th>
              <th className={`${thClass} text-center`}>Terminal</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s, i) => (
              <tr key={i} className="hover:bg-hover">
                <td className={tdClass}><input value={s.name} onChange={e => set(i, { name: e.target.value })} className={`${cellInput} font-mono`} placeholder="nom" /></td>
                <td className={tdClass}><input value={s.label} onChange={e => set(i, { label: e.target.value })} className={cellInput} placeholder="Label" /></td>
                <td className={tdClass}><input value={s.color} onChange={e => set(i, { color: e.target.value })} className={cellInput} placeholder="#6b7280" /></td>
                <td className={`${tdClass} text-center`}><input type="checkbox" checked={s.isApproval} onChange={e => set(i, { isApproval: e.target.checked })} className="h-3 w-3 accent-ink" /></td>
                <td className={`${tdClass} text-center`}><input type="checkbox" checked={s.isTerminal} onChange={e => set(i, { isTerminal: e.target.checked })} className="h-3 w-3 accent-ink" /></td>
                <td className={tdClass}>
                  <div className="flex gap-0.5 justify-end">
                    <button type="button" onClick={() => onChange(moveUp(statuses, i))} disabled={i === 0} className="px-1 text-ink-3 hover:text-ink disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => onChange(moveDown(statuses, i))} disabled={i === statuses.length - 1} className="px-1 text-ink-3 hover:text-ink disabled:opacity-30">↓</button>
                    <ConfirmDelete onConfirm={() => onChange(statuses.filter((_, j) => j !== i))} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={() => onChange([...statuses, emptyStatus()])} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Ajouter un statut</button>
    </div>
  )
}
