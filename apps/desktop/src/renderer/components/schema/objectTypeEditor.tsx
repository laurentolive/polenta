import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HISTORY_TRACKABLE_TYPES, STATUS_HISTORY_KEY, historyModeFor, renameValues, requiredWhenIssues } from '@polenta/types'
import type {
  FieldRename, FieldRenameResult, SchemaField, SchemaStatus, SchemaFieldType, ObjectCategory, ObjectTypeDefinition,
  TypeRenameDto, TypeRenamePlan, TypeRenameResult, ValueRename,
} from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

// ── Editable state types ──────────────────────────────────────────────────────
// Shared between routes/schema.tsx (Liens/Interfaces tabs) and the Structure
// tab's ElementConfigModal, so both edit object types with identical fields.

export interface EditableField {
  name: string; label: string; type: SchemaFieldType
  values: string; required: boolean; default: string; placeholder: string
  /** GH77 — historiser ce champ. */
  trackHistory: boolean
  /** GH195 — champ `link` : liste de liens. */
  multiple: boolean
  /** GH139 — colonne affichée par défaut (défaut de l'équipe, porté par le schéma). */
  defaultVisible: boolean
  /** GH195 — `requiredWhen` en texte : `champ = v1, v2; autre = v3` (cf. `parseRequiredWhen`). */
  requiredWhen: string
  /** GH77 — nom du champ tel que chargé du schéma (non persisté) : absent pour un champ ajouté dans
   *  la session. Un nom différent à l'enregistrement est un renommage (cf. `fieldRenames`). */
  originalName?: string
  /** GH86 — clés du champ que l'éditeur n'affiche pas (`validator`…), réécrites telles quelles. */
  extra?: Record<string, unknown>
}

export interface EditableStatus {
  name: string; label: string; color: string; isApproval: boolean; isTerminal: boolean
  /** GH82 — nom du statut tel que chargé du schéma (non persisté) : absent pour une ligne ajoutée. */
  originalName?: string
  /** GH86 — clés du statut que l'éditeur n'affiche pas, réécrites telles quelles. */
  extra?: Record<string, unknown>
}

export interface EditableObjectType {
  name: string; label: string; color: string; prefix: string; category: ObjectCategory
  fields: EditableField[]; statuses: EditableStatus[]
  /** GH77 — historiser le statut (défaut true). */
  trackStatusHistory: boolean
  /** GH86 — clés du type que l'éditeur n'affiche pas, réécrites telles quelles. */
  extra?: Record<string, unknown>
}

/**
 * GH86 — l'éditeur reconstruit champs, statuts et types à partir de son état éditable : toute clé
 * qu'il ne connaît pas (`validator`, clé ajoutée à la main ou par une version plus récente) était
 * perdue à l'enregistrement. Elles sont mises de côté au chargement et réécrites telles quelles.
 */
function extraKeys(obj: object, editorKeys: readonly string[]): Record<string, unknown> | undefined {
  const rest = Object.fromEntries(Object.entries(obj).filter(([k, v]) => !editorKeys.includes(k) && v !== undefined))
  return Object.keys(rest).length > 0 ? rest : undefined
}

const FIELD_EDITOR_KEYS = ['name', 'label', 'type', 'values', 'required', 'default', 'placeholder', 'trackHistory', 'multiple', 'requiredWhen', 'defaultVisible'] as const
const STATUS_EDITOR_KEYS = ['name', 'label', 'color', 'isApproval', 'isTerminal'] as const
const TYPE_EDITOR_KEYS = ['name', 'label', 'color', 'prefix', 'category', 'fields', 'statuses', 'trackStatusHistory'] as const

// ── Converters ────────────────────────────────────────────────────────────────

export function fieldToEditable(f: SchemaField): EditableField {
  return {
    name: f.name, label: f.label ?? '', type: f.type,
    values: (f.values ?? []).join(', '), required: f.required ?? false,
    default: f.default !== undefined ? String(f.default) : '', placeholder: f.placeholder ?? '',
    trackHistory: f.trackHistory ?? false, originalName: f.name,
    multiple: f.multiple ?? false, requiredWhen: formatRequiredWhen(f.requiredWhen), defaultVisible: f.defaultVisible ?? false,
    ...withExtra(extraKeys(f, FIELD_EDITOR_KEYS)),
  }
}

/** GH195 — `{ status: [approved], safety: [true] }` → `status = approved; safety = true`. */
export function formatRequiredWhen(rw: SchemaField['requiredWhen']): string {
  return Object.entries(rw ?? {}).map(([k, v]) => `${k} = ${(Array.isArray(v) ? v : []).map(String).join(', ')}`).join('; ')
}

/** GH195 — inverse de `formatRequiredWhen` ; texte vide → absent. Une condition sans valeur garde
 *  une liste vide (signalée par `requiredWhenIssues`, refusée à l'enregistrement). */
export function parseRequiredWhen(text: string): SchemaField['requiredWhen'] {
  const out: Record<string, unknown[]> = {}
  for (const part of text.split(';')) {
    if (!part.trim()) continue
    const eq = part.indexOf('=')
    const key = (eq < 0 ? part : part.slice(0, eq)).trim()
    if (!key) continue
    out[key] = eq < 0 ? [] : part.slice(eq + 1).split(',').map(v => v.trim()).filter(Boolean)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function withExtra(extra: Record<string, unknown> | undefined): { extra?: Record<string, unknown> } {
  return extra ? { extra } : {}
}

/** GH77 — `trackHistory` a-t-il un sens pour ce champ ? (type historisable ; pas un champ nommé `status`,
 *  dont la clé d'historique se confondrait avec celle du statut). */
export function canTrackHistory(f: Pick<EditableField, 'name' | 'type'>): boolean {
  return HISTORY_TRACKABLE_TYPES.includes(f.type) && f.name !== STATUS_HISTORY_KEY
}

/** GH77 — champs renommés depuis le chargement du type (nom d'origine connu et différent). */
export function fieldRenames(t: EditableObjectType): FieldRename[] {
  return t.fields
    .filter(f => f.originalName && f.name && f.originalName !== f.name)
    .map(f => ({ from: f.originalName!, to: f.name }))
}

/** GH100 — nom et/ou préfixe d'un type existant changés depuis son chargement ; `null` sinon. */
export function typeRename(
  updated: EditableObjectType, original: ObjectTypeDefinition | null | undefined, nodeName: string,
): TypeRenameDto | null {
  if (!original || !updated.name) return null
  const oldPrefix = original.prefix ?? ''
  if (updated.name === original.name && updated.prefix === oldPrefix) return null
  return {
    nodeName, category: original.category,
    oldName: original.name, newName: updated.name, oldPrefix, newPrefix: updated.prefix,
  }
}

/** GH100 — suite à donner à l'aperçu : refus (rien enregistré), enregistrement direct ou confirmation. */
export function typeRenameDecision(plan: TypeRenamePlan): 'error' | 'direct' | 'confirm' {
  if (plan.errors.length > 0) return 'error'
  return plan.objects.length === 0 && plan.retargeted === 0 && plan.files.length === 0 ? 'direct' : 'confirm'
}

/** Appels de migration après l'enregistrement du schéma (sous-ensemble de l'API renderer). */
export interface MigrationApi {
  renameFields(repoPath: string, objectTypeRef: string, renames: FieldRename[]): Promise<FieldRenameResult>
  renameValues(repoPath: string, objectTypeRef: string, renames: ValueRename[]): Promise<FieldRenameResult>
  renameType(repoPath: string, workspaceDir: string, dto: TypeRenameDto): Promise<TypeRenameResult>
}

/**
 * Migrations dans l'ordre champs (GH77) → valeurs (GH82) → type (GH100) : les deux premières
 * trouvent les objets sous l'**ancien** `objectTypeRef`, que le renommage de type change ensuite.
 */
export function migrationSteps(
  api: MigrationApi, repoPath: string, workspaceDir: string, objectTypeRef: string,
  renames: FieldRename[], chosen: ValueRename[], dto: TypeRenameDto | null,
): Array<() => Promise<FieldRenameResult & { files?: number }>> {
  return [
    ...(renames.length > 0 ? [() => api.renameFields(repoPath, objectTypeRef, renames)] : []),
    ...(chosen.length > 0 ? [() => api.renameValues(repoPath, objectTypeRef, chosen)] : []),
    ...(dto ? [() => api.renameType(repoPath, workspaceDir, dto)] : []),
  ]
}

const isEnum = (type: SchemaFieldType | undefined) => type === 'enum' || type === 'multi_enum'
const splitValues = (values: string) => values.split(',').map(v => v.trim()).filter(Boolean)

/**
 * GH82 — statuts et valeurs d'enum renommés depuis le chargement du type :
 * - statut : ligne dont le nom d'origine diffère du nom courant (une ligne supprimée puis recréée
 *   n'a pas de nom d'origine) ;
 * - valeur : champ existant, `enum` / `multi_enum` avant et après, même nombre de valeurs — chaque
 *   position modifiée dont l'ancienne valeur a disparu de la liste et dont la nouvelle n'y figurait
 *   pas. Réordonner (ou échanger deux valeurs) ne propose donc rien : la saisie ne permet pas de le
 *   distinguer d'un renommage croisé, qui corromprait les données. Un ajout ou un retrait rend la
 *   saisie ambiguë : rien n'est proposé non plus.
 * La cible d'une valeur est le nom *courant* du champ (un renommage de champ est migré avant).
 */
export function valueRenames(updated: EditableObjectType, original: ObjectTypeDefinition | null | undefined): ValueRename[] {
  const out: ValueRename[] = []
  for (const s of updated.statuses) {
    if (s.originalName && s.name && s.originalName !== s.name) out.push({ target: { kind: 'status' }, from: s.originalName, to: s.name })
  }
  for (const f of updated.fields) {
    const before = f.originalName ? original?.fields.find(o => o.name === f.originalName) : undefined
    if (!before || !isEnum(before.type) || !isEnum(f.type) || !f.name) continue
    const oldValues = before.values ?? []
    const newValues = splitValues(f.values)
    if (oldValues.length !== newValues.length) continue
    oldValues.forEach((from, i) => {
      const to = newValues[i]
      if (!to || to === from || newValues.includes(from) || oldValues.includes(to)) return
      out.push({ target: { kind: 'field', field: f.name, multi: f.type === 'multi_enum' }, from, to })
    })
  }
  return out
}

/** GH82 — `default` d'un champ portant une valeur renommée (renommages retenus) : remplacé —
 *  élément de la liste pour un `multi_enum`. */
export function withRenamedDefaults(t: EditableObjectType, renames: ValueRename[]): EditableObjectType {
  return {
    ...t,
    fields: t.fields.map(f => {
      const mine = renames.filter(x => x.target.kind === 'field' && x.target.field === f.name)
      if (mine.length === 0 || !f.default) return f
      const renamed = renameValues({ status: '', fields: { [f.name]: f.default } }, mine)
      return renamed ? { ...f, default: String(renamed.fields[f.name]) } : f
    }),
  }
}

/** GH82 — renommages ciblant le nom d'*origine* des champs (objets sur disque, avant la migration
 *  d'un renommage de champ de la même édition) : pour l'aperçu. */
export function withOriginalFieldNames(t: EditableObjectType, renames: ValueRename[]): ValueRename[] {
  return renames.map(r => {
    if (r.target.kind !== 'field') return r
    const field = r.target.field
    const original = t.fields.find(f => f.name === field)?.originalName ?? field
    return { ...r, target: { ...r.target, field: original } }
  })
}

export function editableToField(f: EditableField): SchemaField {
  const result: SchemaField = { name: f.name, type: f.type }
  if (f.label) result.label = f.label
  if (f.type === 'enum' || f.type === 'multi_enum') result.values = f.values.split(',').map(v => v.trim()).filter(Boolean)
  if (f.required) result.required = true
  if (f.default) result.default = f.default
  if (f.placeholder) result.placeholder = f.placeholder
  if (f.trackHistory && canTrackHistory(f)) result.trackHistory = true
  if (f.type === 'link' && f.multiple) result.multiple = true
  if (f.defaultVisible) result.defaultVisible = true
  const requiredWhen = parseRequiredWhen(f.requiredWhen)
  if (requiredWhen) result.requiredWhen = requiredWhen
  return { ...result, ...f.extra }
}

export function statusToEditable(s: SchemaStatus): EditableStatus {
  return {
    name: s.name, label: s.label ?? '', color: s.color ?? '', isApproval: s.isApproval ?? false, isTerminal: s.isTerminal ?? false,
    originalName: s.name,
    ...withExtra(extraKeys(s, STATUS_EDITOR_KEYS)),
  }
}

export function editableToStatus(s: EditableStatus): SchemaStatus {
  const result: SchemaStatus = { name: s.name }
  if (s.label) result.label = s.label
  if (s.color) result.color = s.color
  if (s.isApproval) result.isApproval = true
  if (s.isTerminal) result.isTerminal = true
  return { ...result, ...s.extra }
}

export function objTypeToEditable(t: ObjectTypeDefinition): EditableObjectType {
  return {
    name: t.name, label: t.label ?? '', color: t.color ?? '', prefix: t.prefix ?? '',
    category: t.category,
    fields: t.fields.map(fieldToEditable),
    statuses: (t.statuses ?? []).map(statusToEditable),
    trackStatusHistory: t.trackStatusHistory !== false,
    ...withExtra(extraKeys(t, TYPE_EDITOR_KEYS)),
  }
}

export function editableToObjType(t: EditableObjectType): ObjectTypeDefinition {
  const result: ObjectTypeDefinition = { name: t.name, category: t.category, fields: t.fields.map(editableToField) }
  if (t.label) result.label = t.label
  if (t.color) result.color = t.color
  if (t.prefix) result.prefix = t.prefix
  if (t.statuses.length > 0) result.statuses = t.statuses.map(editableToStatus)
  if (!t.trackStatusHistory) result.trackStatusHistory = false
  return { ...result, ...t.extra }
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const FIELD_TYPES: SchemaFieldType[] = ['text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user', 'link']

// Couleurs alignées sur les classes status-* (success/warning/danger/neutral) déjà
// utilisées pour le rendu des badges de statut (cf. getStatusClass dans WordView.tsx),
// pour que la couleur par défaut d'un nouveau statut reflète sa sémantique.
export const DEFAULT_REQ_STATUSES: EditableStatus[] = [
  { name: 'draft', label: 'Brouillon', color: '#475569', isApproval: false, isTerminal: false },
  { name: 'review', label: 'En review', color: '#b45309', isApproval: false, isTerminal: false },
  { name: 'approved', label: 'Approuvé', color: '#16a34a', isApproval: true, isTerminal: false },
  { name: 'obsolete', label: 'Obsolète', color: '#dc2626', isApproval: false, isTerminal: true },
]

export const DEFAULT_TEST_STATUSES: EditableStatus[] = [
  { name: 'draft', label: 'Brouillon', color: '#475569', isApproval: false, isTerminal: false },
  { name: 'review', label: 'En review', color: '#b45309', isApproval: false, isTerminal: false },
  { name: 'approved', label: 'Approuvé', color: '#16a34a', isApproval: true, isTerminal: false },
]

// i18n keys, not literal strings — t() isn't available at module scope. See T111-design.md
// "Config module-scope" convention: consumers call t(CATEGORY_LABEL_KEY[category]).
export const CATEGORY_LABEL_KEY: Record<ObjectCategory, string> = {
  requirement: 'schema.editor.requirement',
  test: 'schema.editor.test',
  campaign: 'schema.editor.campaign',
}

// ── Factories ─────────────────────────────────────────────────────────────────

export function emptyField(): EditableField {
  return { name: '', label: '', type: 'text', values: '', required: false, default: '', placeholder: '', trackHistory: false, multiple: false, requiredWhen: '', defaultVisible: false }
}

export function emptyStatus(): EditableStatus {
  return { name: '', label: '', color: '', isApproval: false, isTerminal: false }
}

// Naming convention for a newly added object type: <COMPOSANT>_<SUFFIXE>, ex. VE12A_REQ pour une
// exigence du composant VE12A — reprend le nom (technique, court) du composant/nœud plutôt que son
// label, cohérent avec la convention d'IDs du projet (cf. CLAUDE.md "Convention des IDs").
const CATEGORY_SUFFIX: Record<ObjectCategory, string> = {
  requirement: 'REQ',
  test: 'TEST',
  campaign: 'CAMP',
}

function slugifyComponentName(componentName: string): string {
  return componentName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** `categoryLabel`/`descriptionLabel` are pre-resolved by the caller (`t(CATEGORY_LABEL_KEY[category])`
 *  / a "Description" i18n key) — this module has no access to `useTranslation` outside a component.
 *  GH97 — `taken` : noms de type et préfixes déjà pris ; la proposition prend le premier suffixe
 *  libre (`_2`, `_3`…), sans quoi un 2e type de la même catégorie dans un repo reprendrait le nom et
 *  le préfixe du premier et l'enregistrement serait refusé (préfixe unique, règle 10 CLAUDE.md). */
export function emptyObjType(
  category: ObjectCategory, componentName: string, categoryLabel: string, descriptionLabel: string,
  taken: ReadonlySet<string> = new Set(),
): EditableObjectType {
  const slug = slugifyComponentName(componentName)
  const base = slug ? `${slug}_${CATEGORY_SUFFIX[category]}` : ''
  let suggested = base
  for (let n = 2; base && taken.has(suggested); n++) suggested = `${base}_${n}`
  return {
    name: suggested, label: categoryLabel, color: '', prefix: suggested, category,
    fields: [{ ...emptyField(), name: 'description', label: descriptionLabel, type: 'richtext' }],
    trackStatusHistory: true,
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

export function ConfirmDelete({ onConfirm, className, label, disabled, body }: {
  onConfirm: () => void; className?: string; label?: ReactNode; disabled?: boolean
  /** T123 — override the confirmation body (e.g. to name a cascade-delete's sub-component
   *  count). Defaults to the generic single-element wording used everywhere else. */
  body?: ReactNode
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  useModalHotkeys(() => setPending(false), () => { onConfirm(); setPending(false) }, !pending)

  return (
    <>
      <button type="button" onClick={() => setPending(true)} disabled={disabled} className={className ?? 'px-1 text-status-danger hover:opacity-80'}>{label ?? '×'}</button>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={() => setPending(false)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">{t('schema.editor.deleteElementTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">{body ?? t('schema.editor.deleteElementBody')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPending(false)}
                className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={() => { onConfirm(); setPending(false) }} autoFocus
                className="btn-danger">
                {t('common.delete')}
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
  const { t } = useTranslation()
  useModalHotkeys(onClose, onConfirm)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">{t('schema.editor.cancelChangesTitle')}</h2>
        <p className="text-xs text-ink-2 mb-5">{t('schema.editor.cancelChangesBody')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="btn-secondary">
            {t('common.no')}
          </button>
          <button type="button" onClick={onConfirm} autoFocus
            className="btn-danger">
            {t('schema.editor.confirmCancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FieldsTable ───────────────────────────────────────────────────────────────

export function FieldsTable({ fields, onChange, statuses, category }: {
  fields: EditableField[]
  onChange: (f: EditableField[]) => void
  /** GH195 — statuts et catégorie du type, pour contrôler les `requiredWhen` qui les référencent. */
  statuses?: EditableStatus[]
  category?: ObjectCategory
}) {
  const { t } = useTranslation()
  const set = (i: number, patch: Partial<EditableField>) => {
    const next = [...fields]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const issues = requiredWhenIssues({
    category: category ?? 'requirement',
    statuses: statuses?.map(s => ({ name: s.name })),
    fields: fields.map(editableToField),
  })
  return (
    <div className="mt-3">
      <p className="section-label mb-1">{t('schema.editor.fields')}</p>
      {fields.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>{t('schema.editor.colName')}</th>
              <th className={thClass}>{t('schema.editor.colLabel')}</th>
              <th className={thClass}>{t('schema.editor.colType')}</th>
              <th className={thClass}>{t('schema.editor.colEnumValues')}</th>
              <th className={`${thClass} text-center`}>{t('schema.editor.colRequired')}</th>
              <th className={thClass} title={t('schema.editor.colRequiredWhenTitle')}>{t('schema.editor.colRequiredWhen')}</th>
              <th className={`${thClass} text-center`} title={t('schema.editor.colHistoryTitle')}>{t('schema.editor.colHistory')}</th>
              <th className={`${thClass} text-center`} title={t('schema.editor.colDefaultVisibleTitle')}>{t('schema.editor.colDefaultVisible')}</th>
              <th className={thClass}>{t('schema.editor.colDefault')}</th>
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
                <td className={tdClass}>
                  {f.type === 'link' ? (
                    <label className="flex items-center gap-1 text-ink-2 px-1" title={t('schema.editor.linkMultipleTitle')}>
                      <input type="checkbox" checked={f.multiple} onChange={e => set(i, { multiple: e.target.checked })} className="h-3 w-3 accent-ink" />
                      {t('schema.editor.linkMultiple')}
                    </label>
                  ) : (
                    <input value={f.values} onChange={e => set(i, { values: e.target.value })} disabled={f.type !== 'enum' && f.type !== 'multi_enum'} className={`${cellInput} disabled:opacity-30`} placeholder="a, b, c" />
                  )}
                </td>
                <td className={`${tdClass} text-center`}><input type="checkbox" checked={f.required} onChange={e => set(i, { required: e.target.checked })} className="h-3 w-3 accent-ink" /></td>
                <td className={tdClass}>
                  <RequiredWhenInput
                    value={f.requiredWhen}
                    onChange={v => set(i, { requiredWhen: v })}
                    issues={f.requiredWhen.trim() ? issues.filter(x => x.field === f.name) : []}
                  />
                </td>
                <td className={`${tdClass} text-center`}>
                  <input
                    type="checkbox"
                    aria-label={t('schema.editor.colHistoryTitle')}
                    checked={f.trackHistory && canTrackHistory(f)}
                    disabled={!canTrackHistory(f)}
                    onChange={e => set(i, { trackHistory: e.target.checked })}
                    title={!canTrackHistory(f)
                      ? t('schema.editor.historyNotTrackable')
                      : t(historyModeFor(f.type) === 'event' ? 'schema.editor.historyEvent' : 'schema.editor.historyValue')}
                    className="h-3 w-3 accent-ink disabled:opacity-30"
                  />
                </td>
                <td className={`${tdClass} text-center`}>
                  <input
                    type="checkbox"
                    aria-label={t('schema.editor.colDefaultVisibleTitle')}
                    checked={f.defaultVisible}
                    onChange={e => set(i, { defaultVisible: e.target.checked })}
                    className="h-3 w-3 accent-ink"
                    data-testid="default-visible-checkbox"
                  />
                </td>
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
      <button type="button" onClick={() => onChange([...fields, emptyField()])} className="text-xs text-status-info hover:underline">{t('schema.editor.addField')}</button>
    </div>
  )
}

/** GH195 — saisie de `requiredWhen` (`champ = v1, v2; autre = v3`), ⚠ si incohérent : rouge = refusé à
 *  l'enregistrement, orange = condition inerte (champ ou valeur inconnus). */
function RequiredWhenInput({ value, onChange, issues }: {
  value: string
  onChange: (v: string) => void
  issues: { level: 'error' | 'warning'; message: string }[]
}) {
  const { t } = useTranslation()
  const level = issues.some(x => x.level === 'error') ? 'error' : issues.length ? 'warning' : null
  const messages = issues.map(x => x.message).join('\n')
  return (
    <div className="flex items-center gap-0.5">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${cellInput} font-mono ${level === 'error' ? 'text-status-danger' : ''}`}
        placeholder="status = approved"
        title={messages || t('schema.editor.colRequiredWhenTitle')}
        data-testid="required-when-input"
      />
      {level && <span className={level === 'error' ? 'text-status-danger' : 'text-status-warning'} title={messages}>⚠</span>}
    </div>
  )
}

// ── StatusesTable ─────────────────────────────────────────────────────────────

export function StatusesTable({ statuses, onChange }: { statuses: EditableStatus[]; onChange: (s: EditableStatus[]) => void }) {
  const { t } = useTranslation()
  const set = (i: number, patch: Partial<EditableStatus>) => {
    const next = [...statuses]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  return (
    <div className="mt-3">
      <p className="section-label mb-1">{t('schema.editor.statuses')}</p>
      {statuses.length > 0 && (
        <table className="w-full text-xs border-collapse mb-1">
          <thead>
            <tr>
              <th className={thClass}>{t('schema.editor.colName')}</th>
              <th className={thClass}>{t('schema.editor.colLabel')}</th>
              <th className={thClass}>{t('schema.editor.colColor')}</th>
              <th className={`${thClass} text-center`}>{t('schema.editor.colApproval')}</th>
              <th className={`${thClass} text-center`}>{t('schema.editor.colTerminal')}</th>
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
      <button type="button" onClick={() => onChange([...statuses, emptyStatus()])} className="text-xs text-status-info hover:underline">{t('schema.editor.addStatus')}</button>
    </div>
  )
}
