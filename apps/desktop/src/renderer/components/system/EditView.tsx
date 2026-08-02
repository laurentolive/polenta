import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ObjectTypeDefinition, SchemaField, SchemaFieldType, LinkTypeDefinition, ObjectLink, CoverageStatus, MatrixCell, TestCase } from '@polenta/types'
import { api } from '../../api'
import { LinkCombobox } from './LinkCombobox'
import type { Candidate } from './LinkCombobox'
import { matchesRefs, filterCandidatesByRefs, getPeerId, isLinkTypeValid } from './linkUtils'
import { RichTextField } from '../RichTextField'
import { MultiEnumCheckboxes } from '../MultiEnumCheckboxes'
import { CoverageBadge } from './CoverageBadge'

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSTEM_FIELDS = ['section', 'id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version']

// ── Field control ─────────────────────────────────────────────────────────────

interface FieldControlProps {
  field: SchemaField
  value: string
  onBlur: (value: string) => void
  onChange: (value: string) => void
  readOnly: boolean
  repoPath?: string
  /** T110 sprint 3 — catalogue de rôles du repo courant (`schema.roles`), pour le champ
   *  `multi_enum` nommé `roles` uniquement. `undefined`/vide → fallback sur `field.values`. */
  interfaceRoles?: string[]
}

function FieldControl({ field, value, onBlur, onChange, readOnly, repoPath, interfaceRoles }: FieldControlProps) {
  const { t } = useTranslation()
  const [localVal, setLocalVal] = useState(value)

  useEffect(() => {
    setLocalVal(value)
    onChange(value)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (v: string) => { setLocalVal(v); onChange(v) }

  const base =
    'w-full text-sm text-ink border border-edge rounded px-3 py-1.5 outline-none focus:border-status-info transition-colors bg-surface'
  const roBase =
    'w-full text-sm text-ink-2 bg-hover border border-edge rounded px-3 py-1.5 cursor-default select-all'

  if (readOnly) {
    return <div className={roBase}>{localVal || <span className="text-ink-3 italic">—</span>}</div>
  }

  const type: SchemaFieldType = field.type

  switch (type) {
    case 'textarea':
      return (
        <textarea
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          rows={4}
          className={`${base} resize-y`}
          placeholder={field.placeholder}
        />
      )

    case 'richtext':
      return (
        <RichTextField
          value={localVal}
          onChange={v => set(v)}
          disabled={readOnly}
          placeholder={field.placeholder ?? '(rich text — markdown accepté)'}
          repoPath={repoPath}
        />
      )

    case 'number':
      return (
        <input
          type="number"
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          className={base}
          placeholder={field.placeholder}
        />
      )

    case 'enum': {
      const opts = field.values ?? []
      return (
        <select
          value={localVal}
          onChange={e => { const v = e.target.value; set(v); onBlur(v) }}
          className={base}
        >
          {opts.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      )
    }

    case 'multi_enum':
      // T110 sprint 3 — un champ multi_enum nommé `roles` source ses options depuis le catalogue
      // de rôles du repo courant (source unique, cf. T110) quand ce catalogue est renseigné,
      // au lieu de `field.values` codées en dur. Spécialisation par nom de champ plutôt qu'un
      // nouveau SchemaFieldType dédié (décidé dans specs/T110-design.md — pas de migration de
      // projets existants, un champ `roles` sans catalogue continue de fonctionner à l'identique).
      return (
        <MultiEnumCheckboxes
          field={field}
          value={localVal}
          onChange={v => { set(v); onBlur(v) }}
          interfaceRoles={interfaceRoles}
        />
      )

    case 'boolean': {
      const checked = localVal === 'true' || localVal === '1'
      return (
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => { const v = e.target.checked ? 'true' : 'false'; set(v); onBlur(v) }}
            className="h-4 w-4 accent-ink"
          />
          <span className="text-sm text-ink">{checked ? t('common.yes') : t('common.no')}</span>
        </label>
      )
    }

    case 'date':
      return (
        <input
          type="date"
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          className={base}
        />
      )

    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          className={base}
        />
      )

    case 'user':
      return (
        <input
          type="text"
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          className={base}
          placeholder={field.placeholder ?? t('system.editView.userPlaceholder')}
        />
      )

    case 'drawio':
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={localVal}
            onChange={e => set(e.target.value)}
            onBlur={() => onBlur(localVal)}
            className={`${base} flex-1`}
            placeholder="chemin/vers/fichier.drawio"
          />
          <button
            type="button"
            onClick={() => {
              if (localVal && repoPath) void api.drawio.openExternal(repoPath, localVal)
            }}
            disabled={!localVal || !repoPath}
            className="text-xs px-3 py-1.5 border border-edge rounded hover:bg-hover text-ink-2 disabled:opacity-40 shrink-0"
          >
            Ouvrir dans Draw.io
          </button>
        </div>
      )

    default:
      return (
        <input
          type="text"
          value={localVal}
          onChange={e => set(e.target.value)}
          onBlur={() => onBlur(localVal)}
          className={base}
          placeholder={field.placeholder}
        />
      )
  }
}

// ── FieldRow ─────────────────────────────────────────────────────────────────

function FieldRow({
  field,
  label,
  value,
  system,
  onBlur,
  onChange,
  repoPath,
  interfaceRoles,
}: {
  field: SchemaField
  label: string
  value: string
  system: boolean
  onBlur: (v: string) => void
  onChange: (v: string) => void
  repoPath?: string
  interfaceRoles?: string[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        {label}
        {system && <span className="text-ink-3 font-normal">(sys)</span>}
        {field.required && !system && <span className="text-status-danger">*</span>}
      </label>
      <FieldControl field={field} value={value} onBlur={onBlur} onChange={onChange} readOnly={system} repoPath={repoPath} interfaceRoles={interfaceRoles} />
    </div>
  )
}

// ── LinksSection ──────────────────────────────────────────────────────────────

function LinksSection({
  objectId,
  currentObjectTypeRef = '',
  currentCategory,
  linkTypes,
  objectLinks,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onNavigateToObject,
}: {
  objectId: string
  currentObjectTypeRef?: string
  currentCategory?: string
  linkTypes: LinkTypeDefinition[]
  objectLinks: ObjectLink[]
  repoPath?: string
  candidateObjects?: Candidate[]
  onLinkChange?: () => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
}) {
  const { t } = useTranslation()
  const linksByType = useMemo(() => {
    const map = new Map<string, { outgoing: ObjectLink[]; incoming: ObjectLink[] }>()
    for (const lt of linkTypes) map.set(lt.name, { outgoing: [], incoming: [] })
    for (const link of objectLinks) {
      const entry = map.get(link.type)
      if (!entry) continue
      if (link.sourceId === objectId) entry.outgoing.push(link)
      else entry.incoming.push(link)
    }
    return map
  }, [linkTypes, objectLinks, objectId])

  const handleAdd = async (linkTypeName: string, sourceId: string, targetId: string) => {
    if (!repoPath) return
    await api.requirements.linkCreate(repoPath, { type: linkTypeName, sourceId, targetId })
    onLinkChange?.()
  }

  const handleRemove = async (linkId: string) => {
    if (!repoPath) return
    await api.requirements.linkDelete(repoPath, linkId)
    onLinkChange?.()
  }

  return (
    <div className="border-t border-edge pt-5 space-y-4">
      <p className="text-xs font-medium text-ink-2">{t('system.fieldConfig.links')}</p>
      {linkTypes.filter(isLinkTypeValid).map(lt => {
        const entry = linksByType.get(lt.name)!
        const canBeSource = matchesRefs(currentObjectTypeRef, lt.sourceRefs, currentCategory)
        const canBeTarget = matchesRefs(currentObjectTypeRef, lt.targetRefs, currentCategory)
        // Toujours afficher les liens existants, même dans le sens non canonique pour le
        // schéma actuel (ex. schéma modifié après coup) — sinon un lien créé avant un
        // changement de sourceRefs/targetRefs devient invisible et impossible à délier.
        // La création de nouveaux liens reste, elle, limitée au sens déclaré par le schéma.
        const showOutgoing = canBeSource || entry.outgoing.length > 0
        const showIncoming = canBeTarget || entry.incoming.length > 0
        if (!showOutgoing && !showIncoming) return null
        return (
          <div key={lt.name} className="space-y-3">
            {showOutgoing && (
              <LinkCombobox
                label={lt.labelSourceToTarget}
                existingLinks={entry.outgoing.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeSource ? filterCandidatesByRefs(candidateObjects, lt.targetRefs) : []}
                onAdd={peerId => handleAdd(lt.name, objectId, peerId)}
                onRemove={handleRemove}
                onNavigateToObject={onNavigateToObject}
              />
            )}
            {showIncoming && (
              <LinkCombobox
                label={lt.labelTargetToSource}
                existingLinks={entry.incoming.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeTarget ? filterCandidatesByRefs(candidateObjects, lt.sourceRefs) : []}
                onAdd={peerId => handleAdd(lt.name, peerId, objectId)}
                onRemove={handleRemove}
                onNavigateToObject={onNavigateToObject}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── EditView ──────────────────────────────────────────────────────────────────

export interface EditViewProps {
  nodeId: string | null
  nodeName?: string
  objectData: Record<string, string> | null
  typeDef: ObjectTypeDefinition | undefined
  visibleFields: string[]
  sectionNumbers?: Map<string, string>
  readOnly?: boolean
  linkTypes?: LinkTypeDefinition[]
  objectLinks?: ObjectLink[]
  coverageByReqId?: Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>
  testsById?: Map<string, TestCase>
  repoPath?: string
  candidateObjects?: { id: string; title: string; objectTypeRef: string }[]
  onLinkChange?: () => void
  onBlurField: (field: string, value: string) => void
  onFlushValues: (values: Record<string, string>) => void
  onBack: () => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  children?: React.ReactNode
}

/** T92 — imperative handle so the parent (SystemView's ViewHeader) can trigger the same
 *  flush-then-navigate sequence as the "Retour" button used to, now that EditView no
 *  longer renders its own header/back button (folded into ViewHeader). */
export interface EditViewHandle {
  triggerBack: () => void
}

export const EditView = forwardRef<EditViewHandle, EditViewProps>(function EditView({
  nodeId,
  nodeName,
  objectData,
  typeDef,
  visibleFields,
  sectionNumbers,
  readOnly = false,
  linkTypes = [],
  objectLinks = [],
  coverageByReqId,
  testsById,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onBlurField,
  onFlushValues,
  onBack,
  onNavigateToObject,
  children,
}, ref) {
  const { t } = useTranslation()
  // T110 sprint 3 — catalogue de rôles du repo courant, pour le champ `roles` (voir FieldControl).
  // Une seule requête par montage de vue (pas par champ), clé de cache déjà utilisée ailleurs
  // (StructureTab) — aucun fetch réseau dupliqué si un ancêtre a déjà chargé ce schema.
  const { data: currentSchema } = useQuery({
    queryKey: ['schema', repoPath],
    queryFn: () => api.schema.get(repoPath!),
    enabled: !!repoPath,
  })
  const interfaceRoles = currentSchema?.roles?.map(r => r.name)

  // Local mirror of all field values — updated on every keystroke
  const localValuesRef = useRef<Record<string, string>>({})

  // Sync from server when objectData loads/changes
  useEffect(() => {
    if (objectData) {
      localValuesRef.current = { ...objectData }
    }
  }, [objectData])

  // Navigate away: flush all pending values first
  const handleBack = useCallback(() => {
    onFlushValues(localValuesRef.current)
    onBack()
  }, [onFlushValues, onBack])

  useImperativeHandle(ref, () => ({ triggerBack: handleBack }), [handleBack])

  // T127 — flush pending (unblurred) edits when EditView unmounts for any reason other than
  // the "Retour" button above (which already flushes via handleBack): navigating away through
  // the ActivityBar (Dashboard, Système, ...) swaps the route and unmounts this component
  // directly, without ever calling onBack/handleBack. Richtext fields in particular never fire
  // onBlur (see FieldControl below), so without this their in-progress edits — held only in
  // localValuesRef — were silently discarded. Kept in a ref so this effect can stay mount-once
  // (its cleanup must only run on true unmount, not on every onFlushValues identity change).
  const onFlushValuesRef = useRef(onFlushValues)
  useEffect(() => { onFlushValuesRef.current = onFlushValues }, [onFlushValues])

  useEffect(() => {
    return () => { onFlushValuesRef.current(localValuesRef.current) }
  }, [])

  // ── Keyboard: Escape → back ; Ctrl+Enter → blur active field ─────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
        handleBack()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleBack])

  // ── Build field list ───────────────────────────────────────────────────────

  const getValue = (field: string): string => {
    if (field === 'section') return nodeId ? (sectionNumbers?.get(nodeId) ?? '') : ''
    if (field === 'name') return nodeName ?? ''
    if (field === 'status' && !objectData) return typeDef?.statuses?.[0]?.name ?? ''
    return objectData?.[field] ?? ''
  }

  const systemPseudo: SchemaField[] = SYSTEM_FIELDS.filter(f =>
    visibleFields.includes(f),
  ).map(f => ({ name: f, type: 'text' as const, label: t(labelKeyForSystem(f)) }))

  const customFieldDefs: SchemaField[] = (typeDef?.fields ?? []).filter(f =>
    visibleFields.includes(f.name),
  )

  const orderedFields: { field: SchemaField; system: boolean }[] = visibleFields
    .map(name => {
      if (SYSTEM_FIELDS.includes(name)) {
        const sf = systemPseudo.find(s => s.name === name)
        return sf ? { field: sf, system: true } : null
      }
      if (name === 'name') {
        return { field: { name: 'name', type: 'text' as const, label: t('system.wordView.colName') }, system: false }
      }
      if (name === 'status') {
        const statusField: SchemaField = typeDef?.statuses?.length
          ? { name: 'status', type: 'enum' as const, label: t('system.wordView.colStatus'), values: typeDef.statuses.map(s => s.name) }
          : { name: 'status', type: 'text' as const, label: t('system.wordView.colStatus') }
        return { field: statusField, system: false }
      }
      const cf = customFieldDefs.find(f => f.name === name)
      return cf ? { field: cf, system: false } : null
    })
    .filter((x): x is { field: SchemaField; system: boolean } => x !== null)

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!nodeId) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Sélectionnez un élément dans l'arbre pour l'éditer
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Form ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-6 space-y-5">
          {/* T138 — badge de couverture, toujours affiché pour une exigence (pas d'onglet "Édition"
              dans FieldConfigModal pour le rendre désactivable, cf. specs/T138-design.md §3.4) ;
              hors du pipeline orderedFields/FieldRow — champ non éditable, pas un SchemaField. */}
          {typeDef?.category === 'requirement' && objectData && (
            <div className="flex items-center gap-1.5">
              <CoverageBadge
                coverage={coverageByReqId?.get(objectData['id'] ?? '')}
                testsById={testsById ?? new Map()}
              />
            </div>
          )}
          {orderedFields.length === 0 && (
            <p className="text-sm text-ink-3 italic">
              Aucun champ configuré pour cette vue.
            </p>
          )}
          {(() => {
            const result: React.ReactNode[] = []
            let i = 0
            while (i < orderedFields.length) {
              const { field, system } = orderedFields[i]
              const compact = isCompactField(field.type ?? 'text')
              const next = orderedFields[i + 1]
              const nextCompact = next && isCompactField(next.field.type ?? 'text')
              const makeRow = (f: SchemaField, sys: boolean) => (
                <FieldRow
                  key={f.name}
                  field={f}
                  label={f.label ?? f.name}
                  value={getValue(f.name)}
                  system={sys || readOnly}
                  onBlur={v => !sys && !readOnly && onBlurField(f.name, v)}
                  onChange={v => { if (!sys && !readOnly) localValuesRef.current[f.name] = v }}
                  repoPath={repoPath}
                  interfaceRoles={f.name === 'roles' ? interfaceRoles : undefined}
                />
              )
              if (compact && nextCompact) {
                result.push(
                  <div key={`row-${i}`} className="grid grid-cols-2 gap-4">
                    {makeRow(field, system)}
                    {makeRow(next.field, next.system)}
                  </div>
                )
                i += 2
              } else {
                result.push(makeRow(field, system))
                i += 1
              }
            }
            return result
          })()}

          {/* ── Liens section ── */}
          {linkTypes.length > 0 && objectData && (
            <LinksSection
              objectId={objectData['id'] ?? ''}
              currentObjectTypeRef={objectData['objectTypeRef'] ?? ''}
              currentCategory={typeDef?.category}
              linkTypes={linkTypes}
              objectLinks={objectLinks}
              repoPath={repoPath}
              candidateObjects={candidateObjects}
              onLinkChange={onLinkChange}
              onNavigateToObject={onNavigateToObject}
            />
          )}

          {children}
        </div>
      </div>
    </div>
  )
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCompactField(type: SchemaFieldType | 'text'): boolean {
  return ['text', 'number', 'enum', 'date', 'datetime', 'user', 'boolean'].includes(type)
}

/** T111 — retourne une clé de traduction (convention module-scope : jamais de littéral ici),
 *  résolue via t() par l'appelant. */
function labelKeyForSystem(name: string): string {
  switch (name) {
    case 'section': return 'system.wordView.colSection'
    case 'name': return 'system.wordView.colName'
    case 'id': return 'system.wordView.colId'
    case 'createdAt': return 'system.fieldConfig.colCreatedAt'
    case 'updatedAt': return 'system.fieldConfig.colUpdatedAt'
    case 'author': return 'system.fieldConfig.colAuthor'
    case 'objectTypeRef': return 'system.editView.colType'
    case 'version': return 'system.wordView.colVersion'
    default: return name
  }
}
