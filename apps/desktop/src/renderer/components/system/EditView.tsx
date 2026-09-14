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
  /** T159 — édition utilisateur du champ (frappe) → autosave debouncé. Distinct de `onChange`
   *  (simple miroir local, appelé aussi par la resync depuis le serveur). */
  onEdit?: (value: string) => void
  readOnly: boolean
  repoPath?: string
  /** T110 sprint 3 — catalogue de rôles du repo courant (`schema.roles`), pour le champ
   *  `multi_enum` nommé `roles` uniquement. `undefined`/vide → fallback sur `field.values`. */
  interfaceRoles?: string[]
}

function FieldControl({ field, value, onBlur, onChange, onEdit, readOnly, repoPath, interfaceRoles }: FieldControlProps) {
  const { t } = useTranslation()
  const [localVal, setLocalVal] = useState(value)

  // T159 — le tampon d'affichage (`localVal`) et la dernière valeur serveur réconciliée
  // (`syncedValRef`). Un refetch de l'objet en arrière-plan (autosave d'un champ voisin,
  // retour de focus fenêtre…) ne doit pas réinitialiser l'éditeur en cours de frappe (et le
  // saut de curseur associé) : le richtext notamment ne déclenche aucun `blur`. Cet effet
  // ne touche QUE l'affichage — le miroir `localValuesRef` est la propriété exclusive de
  // l'effet `[objectData]` d'EditView (sinon les deux se marchent dessus au remount).
  const localValRef = useRef(value)
  const syncedValRef = useRef(value)
  useEffect(() => { localValRef.current = localVal }, [localVal])

  useEffect(() => {
    // N'adopter la valeur serveur que si le tampon n'a pas de divergence non sauvegardée ;
    // sinon l'édition de l'utilisateur l'emporte à l'écran jusqu'à sa sauvegarde.
    if (localValRef.current === syncedValRef.current) setLocalVal(value)
    syncedValRef.current = value
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
          onChange={v => { set(v); onEdit?.(v) }}
          disabled={readOnly}
          placeholder={field.placeholder ?? '(rich text — markdown accepté)'}
          repoPath={repoPath}
          // Ctrl+Entrée : flush/valide le champ, comme le blur des autres types de champ.
          onSubmit={() => onBlur(localVal)}
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
  onEdit,
  repoPath,
  interfaceRoles,
}: {
  field: SchemaField
  label: string
  value: string
  system: boolean
  onBlur: (v: string) => void
  onChange: (v: string) => void
  onEdit?: (v: string) => void
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
      <FieldControl field={field} value={value} onBlur={onBlur} onChange={onChange} onEdit={onEdit} readOnly={system} repoPath={repoPath} interfaceRoles={interfaceRoles} />
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
                autoFocus={false}
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
                autoFocus={false}
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
  /** T159 — l'objet du nœud existe mais sa requête est encore en vol (typiquement juste
   *  après un changement d'élément). La vue affiche « Chargement… » plutôt que des champs
   *  vides éditables — sinon une frappe pendant ce laps atterrit dans le mauvais objet. */
  objectLoading?: boolean
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
  /** Persiste en une requête les champs de `values` qui diffèrent de leur valeur serveur.
   *  T159 — `target` cible explicitement un objet + sa baseline (au lieu de l'objet
   *  couramment édité) : nécessaire quand on persiste l'objet SORTANT après un changement
   *  d'`editingNodeId` à EditView monté, `editingObjectId` désignant déjà le nouveau.
   *  Résout à `false` si une écriture a échoué (l'appelant doit retenter). */
  onFlushValues: (
    values: Record<string, string>,
    target?: { objectId: string; category: string; baseline: Record<string, string> },
  ) => Promise<boolean>
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
  objectLoading = false,
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
  // Last server values the mirror was reconciled against (per-field divergence baseline).
  const serverSnapshotRef = useRef<Record<string, string>>({})
  // T159 — has the user changed a field since the last flush was dispatched? Gates every
  // flush so a switch/unmount right after an autosave fired doesn't send a duplicate
  // `update` for the same object (concurrent writes on the same unserialized file).
  const dirtyRef = useRef(false)

  const onFlushValuesRef = useRef(onFlushValues)
  useEffect(() => { onFlushValuesRef.current = onFlushValues }, [onFlushValues])

  // T159 — the richtext field has no onBlur (see FieldControl), so its edits are persisted
  // by this debounced writer: one bulk `update` per fire, gated by `dirtyRef`. The plain
  // inputs keep their immediate `onBlurField` save but call `cancelAutosave()` first, so
  // EditView never has two writes to the same file in flight. `objectId`/`category`/
  // `baseline` are captured when the timer is (re)armed, so a switch landing before it fires
  // can't misroute the outgoing edits. `cancelAutosave` also runs before every explicit
  // flush (unmount, object switch).
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelAutosave = () => {
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
  }
  const flushMirror = (objectId: string, category: string, baseline: Record<string, string>) => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    // Snapshot des valeurs de CET objet : en cas d'échec on doit pouvoir retenter même si
    // le miroir a entre-temps été repointé sur un autre objet (branche switch).
    const values = { ...localValuesRef.current }
    void Promise.resolve(onFlushValuesRef.current(values, { objectId, category, baseline }))
      .then(ok => {
        if (ok) return
        console.error('[EditView] T159 — échec de sauvegarde, nouvelle tentative programmée', { objectId })
        // Retenter directement cet objet (indépendant du miroir courant) après un court délai.
        setTimeout(() => { void onFlushValuesRef.current(values, { objectId, category, baseline }) }, 1500)
      })
      .catch(err => console.error('[EditView] T159 — échec de sauvegarde (exception)', err))
  }
  const scheduleAutosave = () => {
    cancelAutosave()
    const objectId = objectData?.['id'] ?? null
    const category = typeDef?.category ?? ''
    const baseline = { ...serverSnapshotRef.current }
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      if (objectId) flushMirror(objectId, category, baseline)
    }, 800)
  }

  // T159 — `localValuesRef` (the mirror) is owned solely by this effect. FieldControl's own
  // [value] effect only touches its display buffer, never the mirror, so the mirror keeps
  // the outgoing object's unsaved edits intact even when the field list remounts under it.
  //
  //  - Switch to a different object while EditView stays MOUNTED (tree double-click, linked-
  //    object nav, Exigences/Tests tab switch — `editingNodeId`/`objectData` already point at
  //    the new object, or null mid-transition): cancel the debounced autosave, persist the
  //    OUTGOING object explicitly in one bulk `update` (the mirror is still its edits), then
  //    reseed the mirror.
  //  - First mount / same-object refetch / object just created: adopt each server field
  //    EXCEPT where the user has an unsaved local divergence (mirror ≠ last known server
  //    value) — that edit must survive a background refetch (sibling autosave, refocus).
  const prevObjectDataRef = useRef<{ id: string; category: string } | null>(null)
  const seededNodeIdRef = useRef(nodeId)
  useEffect(() => {
    const id = objectData?.['id'] ?? null
    const prev = prevObjectDataRef.current

    // Orphan guard — the tree node changed and the mirror is still dirty from a node whose
    // object was never persisted (`prev` null, so the switch branch below can't flush it):
    // that content isn't ours, drop it rather than let the next flush write it onto the
    // object now being shown. (A switch away from a real object already cleared dirtyRef in
    // the switch branch on the object→null tick.)
    if (seededNodeIdRef.current !== nodeId) {
      seededNodeIdRef.current = nodeId
      if (dirtyRef.current && !prev) {
        localValuesRef.current = {}
        serverSnapshotRef.current = {}
        dirtyRef.current = false
      }
    }

    if (prev && prev.id !== id) {
      cancelAutosave()
      flushMirror(prev.id, prev.category, serverSnapshotRef.current)
      localValuesRef.current = objectData ? { ...objectData } : {}
      serverSnapshotRef.current = objectData ? { ...objectData } : {}
      dirtyRef.current = false
    } else if (objectData) {
      const prevServer = serverSnapshotRef.current
      const mirror = localValuesRef.current
      for (const [k, v] of Object.entries(objectData)) {
        if ((mirror[k] ?? '') === (prevServer[k] ?? '')) mirror[k] = v
      }
      serverSnapshotRef.current = { ...objectData }
    }

    // `objectData` only goes null when the edited object actually changes (react-query keeps
    // data during a same-key refetch), so a null id here means "switched away", not transient.
    prevObjectDataRef.current = id ? { id, category: typeDef?.category ?? '' } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectData, typeDef?.category, nodeId])

  // Navigate away — the outgoing flush is handled by the [objectData] switch branch (linked-
  // object nav keeps EditView mounted) or by the unmount cleanup below (viewMode leaves
  // 'edit'), never here, so this stays a single writer.
  const handleBack = useCallback(() => {
    cancelAutosave()
    onBack()
  }, [onBack])

  useImperativeHandle(ref, () => ({ triggerBack: handleBack }), [handleBack])

  // T127 — flush pending (unblurred) edits when EditView unmounts: the "Retour"/Escape path
  // (viewMode leaves 'edit') and the ActivityBar/route-change path both unmount without ever
  // calling a flush themselves, and richtext fields never fire onBlur (see FieldControl), so
  // their in-progress edits — held only in localValuesRef — would be silently discarded.
  // Mount-once so its cleanup runs only on true unmount. Targeted at the last-shown object
  // via `prevObjectDataRef` (T159) — robust to the final render having nulled out
  // editingNodeId; falls back to the untargeted (creation) path for a brand-new object.
  // Sole writer on this path — handleBack no longer flushes.
  useEffect(() => {
    return () => {
      cancelAutosave()
      if (!dirtyRef.current) return
      const prev = prevObjectDataRef.current
      const p = prev
        ? onFlushValuesRef.current(localValuesRef.current, {
            objectId: prev.id, category: prev.category, baseline: serverSnapshotRef.current,
          })
        : onFlushValuesRef.current(localValuesRef.current)
      void Promise.resolve(p).catch(err => console.error('[EditView] T159 — échec du flush au démontage', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // T159 — pendant le chargement de l'objet (juste après un changement d'élément), ne pas
  // monter le formulaire : des champs vides et éditables absorberaient une frappe dans le
  // mauvais objet. Les hooks ci-dessus (dont l'effet de flush de l'objet sortant) ont déjà
  // tourné — seul le rendu est court-circuité.
  if (objectLoading && !objectData) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        {t('common.loading')}
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
          {/* T159 — keyed on the edited tree node (NOT objectData.id): switching to another
              object while EditView stays mounted (tree double-click, linked-object nav)
              remounts every FieldControl with the new object's values, dropping stale local
              buffer/guard state. Keyed on nodeId rather than the object id so that a brand-
              new node getting its object created (null id → real id) does NOT remount and
              wipe content typed before the title was set. */}
          <React.Fragment key={nodeId ?? 'new'}>
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
                  onBlur={v => {
                    if (sys || readOnly) return
                    // T159 — un save immédiat de ce champ (onBlurField) et l'autosave
                    // debouncé du richtext écriraient le même fichier en concurrence ;
                    // annuler le timer (le richtext reste `dirty`, il sera flushé au
                    // prochain déclencheur) pour garder un seul write en vol.
                    cancelAutosave()
                    onBlurField(f.name, v)
                  }}
                  onChange={v => { if (!sys && !readOnly) { localValuesRef.current[f.name] = v; dirtyRef.current = true } }}
                  onEdit={() => { if (!sys && !readOnly) scheduleAutosave() }}
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
          </React.Fragment>

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
