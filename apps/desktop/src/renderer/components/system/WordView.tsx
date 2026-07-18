import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { Pencil, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { LinkCombobox } from './LinkCombobox'
import type { Candidate } from './LinkCombobox'
import { api } from '../../api'
import type { TypeTreeNode, ObjectTypeDefinition, LinkTypeDefinition, ObjectLink, Requirement, TestCase, SchemaField } from '@polenta/types'
import { matchesRefs, filterCandidatesByRefs, getRelevantLinkTypes, getPeerId, isLinkTypeValid } from './linkUtils'
import { RichTextField } from '../RichTextField'
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'
import { DrawioEmbed } from '../../tiptap/DrawioEmbedExtension'
import { ResizableImage } from '../../tiptap/ResizableImageExtension'

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyObject = Requirement | TestCase | Record<string, unknown>

interface ActiveLinkPopover {
  nodeId: string
  objectId: string
  typeName: string
  top: number
  left: number
  width: number
}

interface Props {
  root: TypeTreeNode[]
  typeDef: ObjectTypeDefinition | undefined
  objects: AnyObject[]
  visibleFields: string[]
  sectionNumbers?: Map<string, string>
  linkTypes?: LinkTypeDefinition[]
  linksByObjectId?: Map<string, ObjectLink[]>
  repoPath?: string
  candidateObjects?: Candidate[]
  onLinkChange?: () => void
  onInlineEdit?: (objectId: string, field: string, value: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
  onEditOpen?: (nodeId: string) => void
  onReopenDraft?: (objectId: string, targetStatus: string) => void
  onNavigateToObject?: (peerId: string) => void
  filter?: string
  stepsByObjectId?: Map<string, { action: string; expectedResult: string }[]>
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
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
  return ['section', 'id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version'].includes(field)
}

// ── FolderHeadingName — inline-editable name inside a heading ─────────────────

function FolderHeadingName({
  node,
  onRename,
}: {
  node: TypeTreeNode
  onRename?: (nodeId: string, name: string) => void
}) {
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
      title={onRename ? 'Cliquer pour renommer' : undefined}
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
      title={onRename ? 'Cliquer pour renommer' : undefined}
    >
      {name}
    </span>
  )
}

// ── RichTextViewer ────────────────────────────────────────────────────────────

function RichTextViewer({ value, repoPath }: { value: string; repoPath?: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false, allowBase64: true, repoPath }),
      Link.configure({ openOnClick: false }),
      Markdown.configure({ html: false, transformPastedText: true }),
      DrawioEmbed.configure({ repoPath }),
    ],
    content: value,
    editable: false,
    editorProps: {
      attributes: {
        class: 'outline-none text-sm text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:p-2 [&_pre]:rounded [&_img]:max-w-full [&_img]:rounded',
      },
    },
  })

  useEffect(() => {
    if (editor) {
      editor.commands.setContent(value, false)
    }
  }, [value, editor])

  return <EditorContent editor={editor} />
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
            />
          </div>
        ) : (
          <div
            className={['text-sm text-ink rounded px-1', onEdit ? 'cursor-text hover:bg-hover' : ''].join(' ')}
            onClick={onEdit ? () => setEditing(true) : undefined}
            title={onEdit ? 'Cliquer pour modifier' : undefined}
          >
            {value ? (
              <RichTextViewer value={value} repoPath={repoPath} />
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
}: {
  label: string
  value: string
  field: string
  objectId: string
  isSystem: boolean
  fieldDef?: SchemaField
  onEdit?: (objectId: string, field: string, value: string) => void
}) {
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
        <span className={`text-xs ${isSystem ? 'text-ink-2' : 'text-ink'}`}>{value || '—'}</span>
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
          className="text-xs text-ink cursor-text hover:bg-hover px-1 rounded flex-1"
          onClick={() => { setDraft(value); setEditing(true) }}
          title="Cliquer pour modifier"
        >
          {value || <span className="text-ink-3 italic">—</span>}
        </span>
      )}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function getStatusClass(status: string): string {
  switch (status) {
    case 'approved':   return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400'
    case 'review':     return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-400'
    case 'obsolete':   return 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400'
    default:           return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
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
  onReopenDraft?: (objectId: string, targetStatus: string) => void
  onLinkClick?: (nodeId: string, objectId: string, typeName: string, rect: DOMRect) => void
  activeLinkKey?: string | null
  steps?: StepDraft[]
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  onNavigateToObject?: (peerId: string) => void
  repoPath?: string
}) {
  const currentStatus = obj ? getFieldValue(obj, 'status') : ''
  const isLocked = !!typeDef?.statuses?.find(s => s.name === currentStatus)?.isApproval

  const [localSteps, setLocalSteps] = useState<StepDraft[]>(steps ?? [])
  useEffect(() => { setLocalSteps(steps ?? []) }, [node.id])

  const handleStepsChange = (newSteps: StepDraft[]) => {
    setLocalSteps(newSteps)
    if (node.objectId) onStepsChange?.(node.objectId, newSteps)
  }

  function getColumnLabel(col: string): string {
    if (col === 'section') return 'N°'
    if (col === 'name') return 'Nom'
    if (col === 'id') return 'ID'
    if (col === 'status') return 'Statut'
    if (col === 'version') return 'Version'
    const field = typeDef?.fields.find(f => f.name === col)
    return field?.label ?? col
  }

  // section / id / status / version sont déjà affichés dans l'en-tête de la carte (cf. ci-dessus) —
  // ne pas les dupliquer dans le corps même s'ils sont cochés dans "Champs visibles"
  const fieldsAlreadyInHeader = new Set(['name', 'section', 'id', 'status', 'version'])
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

  return (
    <div className="border border-edge rounded p-2.5 bg-surface mb-2 group">
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
                      title="Changer le statut"
                    >
                      {typeDef!.statuses!.map(s => (
                        <option key={s.name} value={s.name}>{s.label ?? s.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={badgeClass}>{statusDef?.label ?? status}</span>
                  )
                )}
                {version && (
                  <span className="text-[10px] font-mono text-ink-3 shrink-0">v{version}</span>
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
                className="text-ink-3 hover:text-amber-600 p-1"
                title="Retour en brouillon (nouvelle version)"
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
              title="Éditer"
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
            />
          )
        })}
      </div>

      {/* Steps (test cases) */}
      {steps !== undefined && (
        <div className="mt-3 pt-3 border-t border-edge">
          <p className="text-xs font-medium text-ink-2 mb-3">Étapes</p>
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
            return (
              <div key={lt.name} className="space-y-0.5">
                {canBeSource && (
                  <div
                    data-link-popover
                    className={[
                      'flex items-baseline gap-2 px-1 py-0.5 rounded cursor-pointer',
                      editLinks ? 'hover:bg-hover' : '',
                      isOpenOut ? 'bg-hover ring-1 ring-inset ring-blue-400' : '',
                    ].join(' ')}
                    onClick={editLinks ? e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      editLinks(node.id, node.objectId ?? '', lt.name + '::out', rect)
                    } : undefined}
                    title={editLinks ? 'Cliquer pour modifier les liens' : undefined}
                  >
                    <span className="text-xs text-ink-3 w-28 shrink-0">{lt.labelSourceToTarget}</span>
                    <span className="text-xs text-ink font-mono">
                      {outgoing.length > 0
                        ? outgoing.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ', '}
                              <span
                                className="cursor-pointer hover:underline"
                                title="Cliquer pour naviguer vers cet élément"
                                onClick={e => { e.stopPropagation(); onNavigateToObject?.(id) }}
                              >{id}</span>
                            </span>
                          ))
                        : <span className="text-ink-3 italic">—</span>}
                    </span>
                  </div>
                )}
                {canBeTarget && (
                  <div
                    data-link-popover
                    className={[
                      'flex items-baseline gap-2 px-1 py-0.5 rounded cursor-pointer',
                      editLinks ? 'hover:bg-hover' : '',
                      isOpenIn ? 'bg-hover ring-1 ring-inset ring-blue-400' : '',
                    ].join(' ')}
                    onClick={editLinks ? e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      editLinks(node.id, node.objectId ?? '', lt.name + '::in', rect)
                    } : undefined}
                    title={editLinks ? 'Cliquer pour modifier les liens' : undefined}
                  >
                    <span className="text-xs text-ink-3 w-28 shrink-0">{lt.labelTargetToSource}</span>
                    <span className="text-xs text-ink font-mono">
                      {incoming.length > 0
                        ? incoming.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ', '}
                              <span
                                className="cursor-pointer hover:underline"
                                title="Cliquer pour naviguer vers cet élément"
                                onClick={e => { e.stopPropagation(); onNavigateToObject?.(id) }}
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
  sectionNumbers,
  linkTypes = [],
  linksByObjectId,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onInlineEdit,
  onRenameNode,
  onEditOpen,
  onReopenDraft,
  onNavigateToObject,
  filter,
  stepsByObjectId,
  onStepsChange,
}: Props) {
  const [activeLinkPopover, setActiveLinkPopover] = useState<ActiveLinkPopover | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

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

  // Build object map
  const objectMap = new Map<string, AnyObject>()
  for (const obj of objects) {
    objectMap.set(getObjectId(obj), obj)
  }

  const filterLower = filter?.toLowerCase() ?? ''

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

  function renderNodes(nodes: TypeTreeNode[], depth: number): ReactNode[] {
    const result: ReactNode[] = []

    for (const node of nodes) {
      if (node.kind === 'folder') {
        const section = sectionNumbers?.get(node.id)
        const HeadingTag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(depth, 5)]
        const headingClass = [
          'flex items-center gap-1 font-semibold text-ink mt-4 mb-2',
          depth === 0 ? 'text-xl border-b border-edge pb-1' :
          depth === 1 ? 'text-lg' :
          depth === 2 ? 'text-base' :
          depth === 3 ? 'text-sm' :
          'text-xs',
        ].join(' ')
        const isCollapsed = collapsedFolders.has(node.id)

        result.push(
          <HeadingTag key={node.id} className={headingClass} style={depth > 5 ? { marginLeft: `${(depth - 5) * 16}px` } : undefined}>
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

        if (filterLower) {
          const objStr = [node.name, node.objectId, ...(obj ? Object.values(obj as Record<string, unknown>).map(String) : [])].join(' ').toLowerCase()
          if (!objStr.includes(filterLower)) continue
        }

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
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-2">
        {root.length === 0 ? (
          <p className="text-ink-3 text-sm italic">Aucun élément</p>
        ) : (
          renderNodes(root, 0)
        )}
      </div>

      {/* Link popover — fixed to escape overflow clipping */}
      {activeLinkPopover && activeLt && (() => {
        const { objectId } = activeLinkPopover
        const cellLinks = linksByObjectId?.get(objectId)?.filter(l => l.type === activeLinkTypeName) ?? []
        const currentObjectTypeRef = (objectMap.get(objectId) as Record<string, string>)?.objectTypeRef ?? ''
        const currentCategory = typeDef?.category

        if (activeLinkDirection === 'out' && !matchesRefs(currentObjectTypeRef, activeLt.sourceRefs, currentCategory)) return null
        if (activeLinkDirection === 'in' && !matchesRefs(currentObjectTypeRef, activeLt.targetRefs, currentCategory)) return null

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
                existingLinks={cellLinks.filter(l => l.sourceId === objectId).map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={filterCandidatesByRefs(candidateObjects, activeLt.targetRefs)}
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
                existingLinks={cellLinks.filter(l => l.targetId === objectId).map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={filterCandidatesByRefs(candidateObjects, activeLt.sourceRefs)}
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
