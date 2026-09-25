import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { LinkCombobox } from './LinkCombobox'
import type { Candidate } from './LinkCombobox'
import { api } from '../../api'
import type { TypeTreeNode, ObjectTypeDefinition, LinkTypeDefinition, ObjectLink, Requirement, TestCase, SchemaField, CoverageStatus, MatrixCell } from '@polenta/types'
import { parseMultiEnumValue, serializeMultiEnumValue, resolveMultiEnumOptions } from '@polenta/types'
import { matchesRefs, filterCandidatesByRefs, getRelevantLinkTypes, getPeerId, isLinkTypeValid } from './linkUtils'
import { CoverageBadge } from './CoverageBadge'
import { RevalidationFlag } from './RevalidationFlag'
import { ParamRefText } from '../parameters/ParamRefText'
import { RichTextField } from '../RichTextField'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { buildFilterRegex, NO_FILTER_OPTIONS, type FilterOptions } from '../../lib/textFilter'
import { MultiEnumPopover } from './MultiEnumPopover'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { useScrollToNode } from '../../hooks/useScrollToNode'
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'

// ── Types ─────────────────────────────────────────────────────────────────────

/** T164 — contour persistant de la carte / section ciblée par un "goto" depuis l'arbre.
 *  Anneau bleu plein, distinct de la surbrillance de sélection (fond pâle). */
const GOTO_OUTLINE_CLASS = 'ring-2 ring-inset ring-status-info-solid rounded'

type AnyObject = Requirement | TestCase | Record<string, unknown>

interface ActiveLinkPopover {
  nodeId: string
  objectId: string
  typeName: string
  top: number
  left: number
  width: number
}

interface ActiveMultiEnumPopover {
  objectId: string
  field: string
  top: number
  left: number
  width: number
}

interface Props {
  root: TypeTreeNode[]
  typeDef: ObjectTypeDefinition | undefined
  objects: AnyObject[]
  visibleFields: string[]
  /** T162 — masque les titres de section (H1–H6) : cartes à la suite, collapse ignoré. */
  foldersHidden?: boolean
  sectionNumbers?: Map<string, string>
  linkTypes?: LinkTypeDefinition[]
  linksByObjectId?: Map<string, ObjectLink[]>
  coverageByReqId?: Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>
  testsById?: Map<string, TestCase>
  repoPath?: string
  candidateObjects?: Candidate[]
  onLinkChange?: () => void
  onInlineEdit?: (objectId: string, field: string, value: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
  onEditOpen?: (nodeId: string) => void
  onReopenDraft?: (objectId: string, targetStatus: string) => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  filter?: string
  /** T166 — mode du filtre global (casse / mot entier / regex). Sans lui, le filtre document
   *  restait une sous-chaîne littérale insensible à la casse, incohérent avec l'arbre latéral. */
  filterOptions?: FilterOptions
  stepsByObjectId?: Map<string, { action: string; expectedResult: string }[]>
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  /** T164 — nœud d'arbre (item ou folder) sur lequel se positionner (scroll + contour) ;
   *  `gotoSeq` s'incrémente à chaque requête pour re-scroller sur une cible identique. */
  gotoNodeId?: string | null
  gotoSeq?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getObjectId(obj: AnyObject): string {
  return (obj as Record<string, unknown>)['id'] as string ?? ''
}

function getFieldValue(obj: AnyObject, field: string): string {
  const val = (obj as Record<string, unknown>)[field]
  if (val === undefined || val === null) return ''
  return String(val)
}

function isSystemField(field: string): boolean {
  return ['section', 'id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version', 'coverageStatus'].includes(field)
}

// ── FolderHeadingName — inline-editable name inside a heading ─────────────────

function FolderHeadingName({
  node,
  onRename,
}: {
  node: TypeTreeNode
  onRename?: (nodeId: string, name: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const spanRef = useRef<HTMLSpanElement>(null)

  const commit = () => {
    const next = draft.trim() || node.name
    if (next !== node.name) onRename?.(node.id, next)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(node.name); setEditing(false) }
        }}
        className="bg-transparent outline-none font-semibold text-ink"
        style={{ fontSize: 'inherit', width: `${Math.max(draft.length, 4)}ch` }}
      />
    )
  }

  return (
    <span
      ref={spanRef}
      onClick={onRename ? () => { setDraft(node.name); setEditing(true) } : undefined}
      className={onRename ? 'cursor-text' : undefined}
      title={onRename ? t('system.wordView.clickToRename') : undefined}
    >
      {node.name}
    </span>
  )
}

// ── InlineCardName — editable name in item card header ────────────────────────

function InlineCardName({
  name,
  nodeId,
  onRename,
}: {
  name: string
  nodeId: string
  onRename?: (nodeId: string, name: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const commit = () => {
    const next = draft.trim() || name
    if (next !== name) onRename?.(nodeId, next)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(name); setEditing(false) }
        }}
        className="ml-2 text-sm font-semibold text-ink bg-transparent outline-none"
        style={{ width: `${Math.max(draft.length, 4)}ch` }}
      />
    )
  }

  return (
    <span
      className={['ml-2 text-sm font-semibold text-ink', onRename ? 'cursor-text hover:bg-hover px-0.5 rounded' : ''].join(' ')}
      onClick={onRename ? () => { setDraft(name); setEditing(true) } : undefined}
      title={onRename ? t('system.wordView.clickToRename') : undefined}
    >
      {name}
    </span>
  )
}

// ── RichTextInlineField ───────────────────────────────────────────────────────

function RichTextInlineField({
  label,
  value,
  objectId,
  field,
  onEdit,
  repoPath,
}: {
  label: string
  value: string
  objectId: string
  field: string
  onEdit?: (objectId: string, field: string, value: string) => void
  repoPath?: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  const commit = () => {
    onEdit?.(objectId, field, draft)
    setEditing(false)
  }

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-xs text-ink-3 w-28 shrink-0 mt-0.5">{label}</span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div onBlur={e => {
            // relatedTarget est null quand le focus quitte toute la fenêtre (ex.
            // ouverture d'un dialogue natif comme le sélecteur de fichier draw.io)
            // plutôt que déplacé vers un autre élément de la page — dans ce cas on
            // ne referme pas l'édition, sinon RichTextField (et sa toolbar) se
            // démonte au milieu d'un flux async qui dépend justement d'un tel
            // dialogue (même correctif que RichTextField.tsx).
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
              commit()
            }
          }}>
            <RichTextField
              value={draft}
              onChange={v => setDraft(v)}
              disabled={!onEdit}
              repoPath={repoPath}
              onSubmit={commit}
            />
          </div>
        ) : (
          <div
            className={['text-sm text-ink rounded px-1', onEdit ? 'cursor-text hover:bg-hover' : ''].join(' ')}
            onClick={onEdit ? () => setEditing(true) : undefined}
            title={onEdit ? t('system.shared.clickToEdit') : undefined}
          >
            {value ? (
              <StaticRichTextViewer value={value} repoPath={repoPath} />
            ) : (
              <span className="text-ink-3 italic text-xs">—</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── InlineField ───────────────────────────────────────────────────────────────

function InlineField({
  label,
  value,
  field,
  objectId,
  isSystem,
  fieldDef,
  onEdit,
  onMultiEnumEdit,
  paramRefs = false,
}: {
  label: string
  value: string
  field: string
  objectId: string
  isSystem: boolean
  fieldDef?: SchemaField
  onEdit?: (objectId: string, field: string, value: string) => void
  onMultiEnumEdit?: (objectId: string, field: string, rect: DOMRect) => void
  /** T171 — l'élément est une exigence : ses champs text/textarea portent des références. */
  paramRefs?: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-xs text-ink-3 w-28 shrink-0 mt-0.5">
        {label}
        {isSystem && ' '}
        {isSystem && <span className="text-ink-3/50">(sys)</span>}
      </span>
      {isSystem || !onEdit ? (
        <span className={`text-xs ${isSystem ? 'text-ink-2' : 'text-ink'}`}>
          {value ? (paramRefs && isParamField(fieldDef, isSystem) ? <ParamRefText text={value} /> : value) : '—'}
        </span>
      ) : editing ? (
        fieldDef?.type === 'enum' ? (
          <select
            autoFocus
            ref={el => { if (el) el.showPicker?.() }}
            value={draft}
            onChange={e => { onEdit(objectId, field, e.target.value); setEditing(false) }}
            onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
            className="flex-1 text-xs text-ink bg-surface border border-edge rounded px-1 outline-none"
          >
            {(fieldDef.values ?? []).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onEdit(objectId, field, draft); setEditing(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onEdit(objectId, field, draft); setEditing(false) }
              if (e.key === 'Escape') { setDraft(value); setEditing(false) }
            }}
            className="flex-1 text-xs text-ink bg-surface border border-edge rounded px-1 outline-none"
          />
        )
      ) : (
        <span
          {...(fieldDef?.type === 'multi_enum' ? { 'data-multi-enum-popover': true } : {})}
          className="text-xs text-ink cursor-text hover:bg-hover px-1 rounded flex-1"
          onClick={e => {
            if (fieldDef?.type === 'multi_enum' && onMultiEnumEdit) {
              onMultiEnumEdit(objectId, field, (e.currentTarget as HTMLElement).getBoundingClientRect())
              return
            }
            setDraft(value)
            setEditing(true)
          }}
          title={t('system.shared.clickToEdit')}
        >
          {value
            ? (paramRefs && isParamField(fieldDef, isSystem) ? <ParamRefText text={value} /> : value)
            : <span className="text-ink-3 italic">—</span>}
        </span>
      )}
    </div>
  )
}

/** T171 §3 — champs texte non riches où une référence de paramètre est reconnue. */
function isParamField(fieldDef: SchemaField | undefined, isSystem: boolean): boolean {
  return !isSystem && (fieldDef?.type === 'text' || fieldDef?.type === 'textarea')
}

// ── Status badge ──────────────────────────────────────────────────────────────

function getStatusClass(status: string): string {
  switch (status) {
    case 'approved':   return 'bg-status-success-bg text-status-success'
    case 'review':     return 'bg-status-warning-bg text-status-warning'
    case 'obsolete':   return 'bg-status-danger-bg text-status-danger'
    default:           return 'bg-status-neutral-bg text-status-neutral'
  }
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({
  node,
  obj,
  typeDef,
  visibleFields,
  section,
  linkTypes,
  objectLinks,
  onInlineEdit,
  onRenameNode,
  onEditOpen,
  onReopenDraft,
  onLinkClick,
  activeLinkKey,
  steps,
  onStepsChange,
  onNavigateToObject,
  repoPath,
  onMultiEnumEdit,
  coverageByReqId,
  testsById,
  isGotoTarget,
}: {
  node: TypeTreeNode
  obj: AnyObject | null
  typeDef: ObjectTypeDefinition | undefined
  visibleFields: string[]
  section?: string
  linkTypes?: LinkTypeDefinition[]
  objectLinks?: ObjectLink[]
  onInlineEdit?: (objectId: string, field: string, value: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
  onEditOpen?: (nodeId: string) => void
  coverageByReqId?: Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>
  testsById?: Map<string, TestCase>
  onReopenDraft?: (objectId: string, targetStatus: string) => void
  onLinkClick?: (nodeId: string, objectId: string, typeName: string, rect: DOMRect) => void
  activeLinkKey?: string | null
  steps?: StepDraft[]
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  repoPath?: string
  onMultiEnumEdit?: (objectId: string, field: string, rect: DOMRect) => void
  isGotoTarget?: boolean
}) {
  const { t } = useTranslation()
  const currentStatus = obj ? getFieldValue(obj, 'status') : ''
  const isLocked = !!typeDef?.statuses?.find(s => s.name === currentStatus)?.isApproval

  const [localSteps, setLocalSteps] = useState<StepDraft[]>(steps ?? [])
  useEffect(() => { setLocalSteps(steps ?? []) }, [node.id])

  const handleStepsChange = (newSteps: StepDraft[]) => {
    setLocalSteps(newSteps)
    if (node.objectId) onStepsChange?.(node.objectId, newSteps)
  }

  function getColumnLabel(col: string): string {
    if (col === 'section') return t('system.wordView.colSection')
    if (col === 'name') return t('system.wordView.colName')
    if (col === 'id') return t('system.wordView.colId')
    if (col === 'status') return t('system.wordView.colStatus')
    if (col === 'version') return t('system.wordView.colVersion')
    const field = typeDef?.fields.find(f => f.name === col)
    return field?.label ?? col
  }

  // section / id / status / version sont déjà affichés dans l'en-tête de la carte (cf. ci-dessus) —
  // ne pas les dupliquer dans le corps même s'ils sont cochés dans "Champs visibles". coverageStatus
  // (T138) suit le même chemin : rendu dans l'en-tête, à côté du badge de statut, pas dans le corps.
  // steps a sa propre section dédiée ("Étapes", cf. plus bas) : sans cette exclusion, getFieldValue
  // renvoie le tableau brut (toujours vide à l'affichage) sous une ligne de champ générique libellée
  // "steps" (pas de label déclaré dans typeDef.fields), dupliquant la vraie table Étapes juste en dessous.
  const fieldsAlreadyInHeader = new Set(['name', 'section', 'id', 'status', 'version', 'coverageStatus', 'steps'])
  const fields = (visibleFields.length > 0 ? visibleFields : ['id', 'status'])
    .filter(f => !f.startsWith('link::') && !fieldsAlreadyInHeader.has(f))

  const currentObjectTypeRef = obj ? (obj as Record<string, unknown>)['objectTypeRef'] as string ?? '' : ''
  const currentCategory = typeDef?.category
  const relevantLinkTypes = getRelevantLinkTypes(linkTypes ?? [], currentObjectTypeRef, currentCategory).map(r => r.lt)
  const checkedLinkKeys = visibleFields.filter(f => f.startsWith('link::'))
  const activeLinkTypes = checkedLinkKeys.length > 0
    ? relevantLinkTypes.filter(lt => checkedLinkKeys.includes(`link::${lt.name}`))
    : relevantLinkTypes

  const editInline = isLocked ? undefined : onInlineEdit
  const editRename = isLocked ? undefined : onRenameNode
  const editOpen   = isLocked ? undefined : onEditOpen
  const editLinks  = isLocked ? undefined : onLinkClick
  const editSteps  = isLocked ? undefined : onStepsChange
  const editMultiEnum = isLocked ? undefined : onMultiEnumEdit

  return (
    <div
      data-node-id={node.id}
      className={`border border-edge rounded p-2.5 bg-surface mb-2 group${isGotoTarget ? ` ${GOTO_OUTLINE_CLASS}` : ''}`}
    >
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center flex-wrap gap-x-1.5">
          {section && <span className="font-mono text-xs text-ink-3">{section}</span>}
          <span className="font-mono text-xs text-ink-3">{node.objectId ?? ''}</span>
          <InlineCardName name={node.name} nodeId={node.id} onRename={editRename} />
          {obj && (() => {
            const status = getFieldValue(obj, 'status')
            const version = getFieldValue(obj, 'version')
            const statusDef = typeDef?.statuses?.find(s => s.name === status)
            const badgeClass = `text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${getStatusClass(status)}`
            const canEditStatus = !!editInline && !!typeDef?.statuses?.length && !!node.objectId
            return (
              <>
                {status && (
                  canEditStatus ? (
                    <select
                      value={status}
                      onChange={e => editInline!(node.objectId!, 'status', e.target.value)}
                      className={`${badgeClass} appearance-none cursor-pointer hover:ring-1 hover:ring-current/40 outline-none`}
                      title={t('system.wordView.changeStatus')}
                    >
                      {typeDef!.statuses!.map(s => (
                        <option key={s.name} value={s.name}>{s.label ?? s.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={badgeClass}>{statusDef?.label ?? status}</span>
                  )
                )}
                <RevalidationFlag show={!!(obj as { needsRevalidation?: boolean }).needsRevalidation} />
                {version && (
                  <span className="text-[10px] font-mono text-ink-3 shrink-0">v{version}</span>
                )}
                {visibleFields.includes('coverageStatus') && typeDef?.category === 'requirement' && node.objectId && (
                  <CoverageBadge
                    coverage={coverageByReqId?.get(node.objectId)}
                    testsById={testsById ?? new Map()}
                  />
                )}
              </>
            )
          })()}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {isLocked && onReopenDraft && node.objectId && (() => {
            const draftStatus = typeDef?.statuses?.find(s => !s.isApproval && !s.isTerminal)?.name ?? 'draft'
            return (
              <button
                type="button"
                onClick={() => onReopenDraft(node.objectId!, draftStatus)}
                className="text-ink-3 hover:text-status-warning p-1"
                title={t('system.wordView.reopenDraft')}
              >
                <RotateCcw size={14} />
              </button>
            )
          })()}
          {editOpen && (
            <button
              type="button"
              onClick={() => editOpen(node.id)}
              className="text-ink-3 hover:text-ink p-1"
              title={t('system.shared.editItem')}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        {fields.map(col => {
          const fieldDef: SchemaField | undefined = col === 'status'
            ? (typeDef?.statuses?.length
              ? { name: 'status', type: 'enum' as const, values: typeDef.statuses.map(s => s.name) }
              : undefined)
            : typeDef?.fields.find(f => f.name === col)
          const value = col === 'section'
            ? (section ?? '')
            : obj ? getFieldValue(obj, col) : (col === 'id' ? node.objectId ?? '' : '')
          if (fieldDef?.type === 'richtext') {
            return (
              <RichTextInlineField
                key={col}
                label={getColumnLabel(col)}
                value={value}
                objectId={node.objectId ?? ''}
                field={col}
                onEdit={editInline}
                repoPath={repoPath}
              />
            )
          }
          return (
            <InlineField
              key={col}
              label={getColumnLabel(col)}
              value={value}
              field={col}
              objectId={node.objectId ?? ''}
              isSystem={isSystemField(col)}
              fieldDef={fieldDef}
              onEdit={editInline}
              onMultiEnumEdit={editMultiEnum}
              paramRefs={typeDef?.category === 'requirement'}
            />
          )
        })}
      </div>

      {/* Steps (test cases) */}
      {steps !== undefined && (
        <div className="mt-3 pt-3 border-t border-edge">
          <p className="text-xs font-medium text-ink-2 mb-3">{t('system.wordView.stepsHeading')}</p>
          <StepsTable
            steps={localSteps}
            onChange={handleStepsChange}
            disabled={!editSteps}
            repoPath={repoPath}
          />
        </div>
      )}

      {/* Links */}
      {activeLinkTypes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-edge space-y-1">
          {activeLinkTypes.filter(isLinkTypeValid).map(lt => {
            const links = objectLinks ?? []
            const outgoing = links.filter(l => l.type === lt.name && l.sourceId === node.objectId).map(l => l.targetId)
            const incoming = links.filter(l => l.type === lt.name && l.targetId === node.objectId).map(l => l.sourceId)
            const isOpenOut = activeLinkKey === `${node.id}::${lt.name}::out`
            const isOpenIn = activeLinkKey === `${node.id}::${lt.name}::in`
            const canBeSource = matchesRefs(currentObjectTypeRef, lt.sourceRefs, currentCategory)
            const canBeTarget = matchesRefs(currentObjectTypeRef, lt.targetRefs, currentCategory)
            // Toujours afficher les liens existants, même dans le sens non canonique pour le
            // schéma actuel — sinon un lien créé avant un changement de sourceRefs/targetRefs
            // devient invisible et impossible à délier. La création reste limitée au sens déclaré.
            const showOutgoing = canBeSource || outgoing.length > 0
            const showIncoming = canBeTarget || incoming.length > 0
            return (
              <div key={lt.name} className="space-y-0.5">
                {showOutgoing && (
                  <div
                    data-link-popover
                    className={[
                      'flex items-baseline gap-2 px-1 py-0.5 rounded cursor-pointer',
                      editLinks ? 'hover:bg-hover' : '',
                      isOpenOut ? 'bg-hover ring-1 ring-inset ring-status-info' : '',
                    ].join(' ')}
                    onClick={editLinks ? e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      editLinks(node.id, node.objectId ?? '', lt.name + '::out', rect)
                    } : undefined}
                    title={editLinks ? t('system.wordView.clickToEditLinks') : undefined}
                  >
                    <span className="text-xs text-ink-3 w-28 shrink-0">{lt.labelSourceToTarget}</span>
                    <span className="text-xs text-ink font-mono">
                      {outgoing.length > 0
                        ? outgoing.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ', '}
                              <span
                                className="cursor-pointer hover:underline"
                                title={t('system.shared.clickToNavigate')}
                                onClick={e => { e.stopPropagation(); onNavigateToObject?.(id, { newTab: e.ctrlKey || e.metaKey }) }}
                              >{id}</span>
                            </span>
                          ))
                        : <span className="text-ink-3 italic">—</span>}
                    </span>
                  </div>
                )}
                {showIncoming && (
                  <div
                    data-link-popover
                    className={[
                      'flex items-baseline gap-2 px-1 py-0.5 rounded cursor-pointer',
                      editLinks ? 'hover:bg-hover' : '',
                      isOpenIn ? 'bg-hover ring-1 ring-inset ring-status-info' : '',
                    ].join(' ')}
                    onClick={editLinks ? e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      editLinks(node.id, node.objectId ?? '', lt.name + '::in', rect)
                    } : undefined}
                    title={editLinks ? t('system.wordView.clickToEditLinks') : undefined}
                  >
                    <span className="text-xs text-ink-3 w-28 shrink-0">{lt.labelTargetToSource}</span>
                    <span className="text-xs text-ink font-mono">
                      {incoming.length > 0
                        ? incoming.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ', '}
                              <span
                                className="cursor-pointer hover:underline"
                                title={t('system.shared.clickToNavigate')}
                                onClick={e => { e.stopPropagation(); onNavigateToObject?.(id, { newTab: e.ctrlKey || e.metaKey }) }}
                              >{id}</span>
                            </span>
                          ))
                        : <span className="text-ink-3 italic">—</span>}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function WordView({
  root,
  typeDef,
  objects,
  visibleFields,
  foldersHidden = false,
  sectionNumbers,
  linkTypes = [],
  linksByObjectId,
  coverageByReqId,
  testsById,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onInlineEdit,
  onRenameNode,
  onEditOpen,
  onReopenDraft,
  onNavigateToObject,
  filter,
  filterOptions,
  stepsByObjectId,
  onStepsChange,
  gotoNodeId,
  gotoSeq,
}: Props) {
  const { t } = useTranslation()
  // T126 sprint 2 — catalogue de rôles du repo courant, pour le champ multi_enum nommé `roles`.
  // useProjectSchema (staleTime: Infinity) plutôt qu'une useQuery locale — même clé de cache que
  // SystemViewContext, aucune requête réseau dupliquée.
  const { data: currentSchema } = useProjectSchema(repoPath ?? '')
  const interfaceRoles = currentSchema?.roles?.map(r => r.name)
  const [activeLinkPopover, setActiveLinkPopover] = useState<ActiveLinkPopover | null>(null)
  const [activeMultiEnumPopover, setActiveMultiEnumPopover] = useState<ActiveMultiEnumPopover | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  // T164 — "goto" : défiler jusqu'à la carte / l'en-tête portant data-node-id.
  const containerRef = useRef<HTMLDivElement>(null)
  useScrollToNode(containerRef, gotoNodeId, gotoSeq)

  const toggleFolder = useCallback((id: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!activeLinkPopover) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-link-popover]')) setActiveLinkPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeLinkPopover])

  useEffect(() => {
    if (!activeMultiEnumPopover) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-multi-enum-popover]')) setActiveMultiEnumPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeMultiEnumPopover])

  // Build object map
  const objectMap = new Map<string, AnyObject>()
  for (const obj of objects) {
    objectMap.set(getObjectId(obj), obj)
  }

  // T166 — honore le mode du filtre global (casse / mot entier / regex), comme l'arbre latéral
  // et le filtre par colonne (T51). buildFilterRegex renvoie null si le filtre est vide OU si
  // l'expression regex est invalide → dans les deux cas on n'exclut aucune ligne.
  const filterRe = buildFilterRegex(filter ?? '', filterOptions ?? NO_FILTER_OPTIONS)

  function itemMatchesFilter(node: TypeTreeNode, obj: AnyObject | null): boolean {
    if (!filterRe) return true
    // Périmètre : nom de nœud + objectId + toutes les valeurs de champs (champs masqués inclus),
    // testés un par un — pas de haystack joint, pour qu'une regex ne matche pas à cheval sur
    // deux champs.
    if (filterRe.test(node.name)) return true
    if (node.objectId && filterRe.test(node.objectId)) return true
    if (obj) {
      for (const v of Object.values(obj as Record<string, unknown>)) {
        if (filterRe.test(String(v))) return true
      }
    }
    return false
  }

  // Un dossier/section ne doit s'afficher, quand un filtre est actif, que s'il contient au
  // moins un élément descendant qui matche — sinon on se retrouve avec des sections vides
  // affichées parmi des résultats filtrés, ce qui est trompeur (la section n'a rien à montrer).
  function folderHasMatchingDescendant(node: TypeTreeNode): boolean {
    return node.children.some(child => {
      if (child.kind === 'folder') return folderHasMatchingDescendant(child)
      const obj = child.objectId ? (objectMap.get(child.objectId) ?? null) : null
      return itemMatchesFilter(child, obj)
    })
  }

  function handleLinkClick(nodeId: string, objectId: string, typeKey: string, rect: DOMRect) {
    const key = `${nodeId}::${typeKey}`
    if (activeLinkPopover && `${activeLinkPopover.nodeId}::${activeLinkPopover.typeName}` === key) {
      setActiveLinkPopover(null)
      return
    }
    setActiveLinkPopover({
      nodeId,
      objectId,
      typeName: typeKey,
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    })
  }

  function handleMultiEnumClick(objectId: string, field: string, rect: DOMRect) {
    if (activeMultiEnumPopover?.objectId === objectId && activeMultiEnumPopover.field === field) {
      setActiveMultiEnumPopover(null)
      return
    }
    setActiveMultiEnumPopover({ objectId, field, top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  function renderNodes(nodes: TypeTreeNode[], depth: number): ReactNode[] {
    const result: ReactNode[] = []

    for (const node of nodes) {
      if (node.kind === 'folder') {
        if (filterRe && !folderHasMatchingDescendant(node)) continue

        // T162 — titres masqués : pas de <Hn>, collapse ignoré, on descend toujours dans
        // les enfants (liste plate de cartes, numéro de section conservé sur chaque carte).
        if (foldersHidden) {
          result.push(...renderNodes(node.children, depth + 1))
          continue
        }

        const section = sectionNumbers?.get(node.id)
        const HeadingTag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(depth, 5)]
        const headingClass = [
          'flex items-center gap-1 font-semibold text-ink mt-4 mb-2',
          depth === 0 ? 'text-xl border-b border-edge pb-1' :
          depth === 1 ? 'text-lg' :
          depth === 2 ? 'text-base' :
          depth === 3 ? 'text-sm' :
          'text-xs',
          gotoNodeId === node.id ? GOTO_OUTLINE_CLASS : '',
        ].join(' ')
        const isCollapsed = collapsedFolders.has(node.id)

        result.push(
          <HeadingTag key={node.id} data-node-id={node.id} className={headingClass} style={depth > 5 ? { marginLeft: `${(depth - 5) * 16}px` } : undefined}>
            <button
              type="button"
              onClick={() => toggleFolder(node.id)}
              className="text-ink-3 hover:text-ink shrink-0"
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            {section && <span className="font-mono font-normal text-ink-3 mr-2">{section}</span>}
            <FolderHeadingName node={node} onRename={onRenameNode} />
          </HeadingTag>
        )
        if (!isCollapsed) {
          result.push(...renderNodes(node.children, depth + 1))
        }
      } else {
        const obj = node.objectId ? (objectMap.get(node.objectId) ?? null) : null

        if (!itemMatchesFilter(node, obj)) continue

        const activeLinkKey = activeLinkPopover?.nodeId === node.id
          ? `${node.id}::${activeLinkPopover.typeName}`
          : null

        result.push(
          <ItemCard
            key={node.id}
            node={node}
            obj={obj}
            typeDef={typeDef}
            visibleFields={visibleFields}
            section={sectionNumbers?.get(node.id)}
            linkTypes={linkTypes}
            objectLinks={node.objectId ? (linksByObjectId?.get(node.objectId) ?? []) : []}
            coverageByReqId={coverageByReqId}
            testsById={testsById}
            onInlineEdit={onInlineEdit}
            onRenameNode={onRenameNode}
            onEditOpen={onEditOpen}
            onReopenDraft={onReopenDraft}
            onLinkClick={repoPath ? handleLinkClick : undefined}
            activeLinkKey={activeLinkKey}
            steps={stepsByObjectId !== undefined && node.objectId ? (stepsByObjectId.get(node.objectId) ?? []) : undefined}
            onStepsChange={onStepsChange}
            onNavigateToObject={onNavigateToObject}
            repoPath={repoPath}
            onMultiEnumEdit={repoPath ? handleMultiEnumClick : undefined}
            isGotoTarget={gotoNodeId === node.id}
          />
        )
      }
    }

    return result
  }

  // Resolve the active link popover's link type (strips ::out / ::in suffix)
  const activeLinkTypeName = activeLinkPopover?.typeName.replace(/::(?:out|in)$/, '')
  const activeLinkDirection = activeLinkPopover?.typeName.endsWith('::in') ? 'in' : 'out'
  const activeLt = linkTypes.find(l => l.name === activeLinkTypeName)

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <div className="px-6 py-2">
        {root.length === 0 ? (
          <p className="text-ink-3 text-sm italic">{t('common.noElements')}</p>
        ) : (
          renderNodes(root, 0)
        )}
      </div>

      {/* Multi-enum popover — fixed to escape overflow clipping */}
      {activeMultiEnumPopover && (() => {
        const popoverObj = objectMap.get(activeMultiEnumPopover.objectId)
        const popoverValue = popoverObj ? getFieldValue(popoverObj, activeMultiEnumPopover.field) : ''
        const fieldDef = typeDef?.fields.find(f => f.name === activeMultiEnumPopover.field)
        const options = fieldDef ? resolveMultiEnumOptions(fieldDef, interfaceRoles) : []
        const selected = parseMultiEnumValue(popoverValue)
        return (
          <MultiEnumPopover
            options={options}
            selected={selected}
            onToggle={v => {
              const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]
              onInlineEdit?.(activeMultiEnumPopover.objectId, activeMultiEnumPopover.field, serializeMultiEnumValue(next))
            }}
            onClose={() => setActiveMultiEnumPopover(null)}
            style={{ top: activeMultiEnumPopover.top, left: activeMultiEnumPopover.left, minWidth: activeMultiEnumPopover.width }}
          />
        )
      })()}

      {/* Link popover — fixed to escape overflow clipping */}
      {activeLinkPopover && activeLt && (() => {
        const { objectId } = activeLinkPopover
        const cellLinks = linksByObjectId?.get(objectId)?.filter(l => l.type === activeLinkTypeName) ?? []
        const currentObjectTypeRef = (objectMap.get(objectId) as Record<string, string>)?.objectTypeRef ?? ''
        const currentCategory = typeDef?.category
        const canBeSource = matchesRefs(currentObjectTypeRef, activeLt.sourceRefs, currentCategory)
        const canBeTarget = matchesRefs(currentObjectTypeRef, activeLt.targetRefs, currentCategory)
        const outgoingLinks = cellLinks.filter(l => l.sourceId === objectId)
        const incomingLinks = cellLinks.filter(l => l.targetId === objectId)

        // Toujours afficher les liens existants, même dans le sens non canonique pour le
        // schéma actuel — sinon un lien créé avant un changement de sourceRefs/targetRefs
        // devient invisible et impossible à délier. La création reste limitée au sens déclaré.
        if (activeLinkDirection === 'out' && !canBeSource && outgoingLinks.length === 0) return null
        if (activeLinkDirection === 'in' && !canBeTarget && incomingLinks.length === 0) return null

        return (
          <div
            data-link-popover
            className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl p-3"
            style={{ top: activeLinkPopover.top, left: activeLinkPopover.left, width: activeLinkPopover.width }}
            onClick={e => e.stopPropagation()}
          >
            {activeLinkDirection === 'out' ? (
              <LinkCombobox
                label={activeLt.labelSourceToTarget}
                existingLinks={outgoingLinks.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeSource ? filterCandidatesByRefs(candidateObjects, activeLt.targetRefs) : []}
                onAdd={async peerId => {
                  if (!repoPath) return
                  await api.requirements.linkCreate(repoPath, { type: activeLinkTypeName!, sourceId: objectId, targetId: peerId })
                  onLinkChange?.()
                }}
                onRemove={async linkId => {
                  if (!repoPath) return
                  await api.requirements.linkDelete(repoPath, linkId)
                  onLinkChange?.()
                }}
              />
            ) : (
              <LinkCombobox
                label={activeLt.labelTargetToSource}
                existingLinks={incomingLinks.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeTarget ? filterCandidatesByRefs(candidateObjects, activeLt.sourceRefs) : []}
                onAdd={async peerId => {
                  if (!repoPath) return
                  await api.requirements.linkCreate(repoPath, { type: activeLinkTypeName!, sourceId: peerId, targetId: objectId })
                  onLinkChange?.()
                }}
                onRemove={async linkId => {
                  if (!repoPath) return
                  await api.requirements.linkDelete(repoPath, linkId)
                  onLinkChange?.()
                }}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
