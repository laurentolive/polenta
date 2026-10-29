import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import yaml from 'js-yaml'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DiffNode, OutputPath, Side } from '@polenta/merge-core'
import { parseMultiEnumValue, type ObjectTypeDefinition, type SchemaField } from '@polenta/types'
import { DynamicField } from '../DynamicField'
import { diffPrefs } from '../../lib/diffPrefs'
import type { ResolvedBlock } from '../merge/blockLocator'
import { Value } from './TreeDiffView'
import { outputAt, type MergeRow, type MergeTreeModel } from './mergeModel'
import type { Presentation } from './presentation'

export { mergeDescFor, outputAt, useMergeTree, type MergeRow, type MergeTreeModel } from './mergeModel'

/**
 * GH222 sprint 4 — vue générique en **merge** (spec §4.1) : la rangée du haut (mes modifications |
 * [ancêtre] | destination) et la sortie ont chacune leur colonne Structure ; les deux grilles
 * montrent les **mêmes nœuds** (union des deux côtés, alignés), se replient ensemble et défilent de
 * façon synchronisée (`data-row-key`). Chaque bloc de conflit est rattaché à sa rangée : actions
 * dans chaque panneau, carte de conflit dans la sortie, blocs résolus marqués. La sortie reste un
 * texte (source de vérité) : une édition en place passe par `updateOutputAt`.
 */

const INDENT = 12
const MAX_INDENT_LEVELS = 6

// ─── Grilles ─────────────────────────────────────────────────────────────────────────

function StructureCell({ row, model }: { row: MergeRow; model: MergeTreeModel }) {
  const { t } = useTranslation()
  const n = row.node
  const level = Math.min(row.depth, MAX_INDENT_LEVELS)
  const conflict = model.rowConflicts.has(n.key)
  const dot = conflict ? 'bg-diff-conflict' : model.rowResolved.has(n.key) ? 'bg-diff-resolved'
    : model.changedLeft.has(n.key) ? 'bg-diff-auto-left' : model.changedRight.has(n.key) ? 'bg-diff-auto-right' : ''
  return (
    <div className="min-w-0 flex items-start gap-1 py-1 pr-1 text-xs text-ink-2 border-r border-edge bg-canvas relative"
      style={{ paddingLeft: 4 + level * INDENT }} title={row.trail}
      data-row-key={n.key} data-conflict={conflict || undefined}>
      {Array.from({ length: level }, (_, i) => (
        <span key={i} aria-hidden className="absolute top-0 bottom-0 border-l border-edge-subtle" style={{ left: 9 + i * INDENT }} />
      ))}
      {row.children.length > 0
        ? (
          <button type="button" className="shrink-0 text-ink-3 hover:text-ink mt-px" onClick={() => model.toggle(n)}
            aria-expanded={row.expanded} aria-label={row.expanded ? t('treediff.collapse') : t('treediff.expand')}>
            {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )
        : <span className="w-3 shrink-0" />}
      <span className="truncate flex-1 min-w-0">{model.presentation.label(n)}</span>
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${dot}`} aria-hidden />}
    </div>
  )
}

function Grid({ columns, header, children, treeWidth }: { columns: number; header: ReactNode; children: ReactNode; treeWidth: number }) {
  return (
    <div className="grid min-w-0" style={{ gridTemplateColumns: `${treeWidth}px repeat(${columns}, minmax(0, 1fr))` }}>
      {header}
      {children}
    </div>
  )
}

function HeaderCell({ children, border }: { children: ReactNode; border?: boolean }) {
  return (
    <div className={`sticky top-0 z-10 px-3 py-1 bg-canvas border-b border-edge text-[11px] uppercase tracking-wide text-ink-3 truncate ${border ? 'border-l' : 'border-r'}`}>
      {children}
    </div>
  )
}

const ACTION = 'px-1.5 py-px rounded border border-edge bg-surface text-[11px] text-ink hover:bg-surface-hover'

/** Rangée du haut : mes modifications | [ancêtre commun] | destination. */
export function MergeTreeTop({ model, showBase, labels, typeDef, repoPath, onTake }: {
  model: MergeTreeModel
  showBase: boolean
  labels: { left: string; base: string; right: string }
  typeDef?: ObjectTypeDefinition
  repoPath: string
  onTake: (blockKey: string, side: Side) => void
}) {
  const { t } = useTranslation()
  const treeWidth = diffPrefs.treeWidth()
  const p = model.presentation
  const cell = (row: MergeRow, pane: 'left' | 'base' | 'right') => {
    const n = row.node
    const b = model.baseAt.get(n.key)
    const has = pane === 'left' ? n.hasBefore : pane === 'right' ? n.hasAfter : !!b?.has
    const value = pane === 'left' ? n.before : pane === 'right' ? n.after : b?.value
    const changed = pane === 'left' ? model.changedLeft.has(n.key) : pane === 'right' ? model.changedRight.has(n.key) : false
    const tone = !changed ? '' : pane === 'left' ? 'bg-diff-left-line' : 'bg-diff-right-line'
    const blocks = model.rowConflicts.get(n.key) ?? []
    const border = pane === 'left' ? '' : 'border-l border-edge'
    return (
      <div key={pane} className={`min-w-0 px-3 py-1 ${border} ${tone} ${has ? '' : 'diff-hatch'}`}>
        {pane !== 'base' && blocks.map(block => (
          <button key={block} type="button" className={`${ACTION} mb-1 mr-1`} onClick={() => onTake(block, pane)}
            title={blocks.length > 1 ? block : undefined}>
            {pane === 'left' ? t('mergeResolve.takeLeft') : t('mergeResolve.takeRight')}
          </button>
        ))}
        {!has
          ? <span className="text-[11px] text-ink-3 italic">{t('diffView.absentUnit')}</span>
          : row.children.length > 0
            ? (!row.expanded && <span className="text-[11px] text-ink-3">{t('treediff.summary', { count: row.children.length, changed: 0 })}</span>)
            : <Value node={n} value={value} other={changed && b?.has ? b.value : undefined} side="after"
                presentation={p} typeDef={typeDef} repoPath={repoPath} at={null} />}
      </div>
    )
  }
  return (
    <Grid columns={showBase ? 3 : 2} treeWidth={treeWidth} header={(
      <>
        <HeaderCell>{t('treediff.structure')}</HeaderCell>
        <HeaderCell>{labels.left}</HeaderCell>
        {showBase && <HeaderCell border>{labels.base}</HeaderCell>}
        <HeaderCell border>{labels.right}</HeaderCell>
      </>
    )}>
      {model.rows.map(row => (
        <div key={row.node.key} className="contents">
          <StructureCell row={row} model={model} />
          {cell(row, 'left')}
          {showBase && cell(row, 'base')}
          {cell(row, 'right')}
        </div>
      ))}
    </Grid>
  )
}

/** Sortie du merge : valeurs éditables, cartes de conflit, blocs résolus. */
export function MergeTreeOutput({ model, typeDef, repoPath, canBoth, onTake, onBoth, onReset, onEdit, labels }: {
  model: MergeTreeModel
  typeDef?: ObjectTypeDefinition
  repoPath: string
  canBoth: (blockKey: string) => boolean
  onTake: (blockKey: string, side: Side) => void
  onBoth: (blockKey: string) => void
  onReset: (block: ResolvedBlock) => void
  onEdit: (path: OutputPath, value: unknown) => void
  labels: { output: string; resolved: Record<'left' | 'right' | 'both', string> }
}) {
  const { t } = useTranslation()
  const treeWidth = diffPrefs.treeWidth()
  const p = model.presentation
  // One card per open block — several blocks may share a row (two ranges of the same list).
  const card = (block: string, label?: string) => (
    <div key={block} className="min-w-0 px-3 py-1 border-l-[3px] border-diff-conflict bg-diff-conflict-bg" data-conflict-card={block} data-unit={block}>
      <p className="text-[11px] font-semibold text-status-warning mb-1">{label ?? t('mergeResolve.rendered.conflict')}</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={ACTION} onClick={() => onTake(block, 'left')}>{t('mergeResolve.takeLeft')}</button>
        <button type="button" className={ACTION} onClick={() => onTake(block, 'right')}>{t('mergeResolve.takeRight')}</button>
        {canBoth(block) && <button type="button" className={ACTION} onClick={() => onBoth(block)}>{t('mergeResolve.takeBoth')}</button>}
      </div>
    </div>
  )
  const cell = (row: MergeRow) => {
    const n = row.node
    const blocks = model.rowConflicts.get(n.key)
    if (blocks) {
      return <div className="min-w-0 flex flex-col gap-px">{blocks.map(b => card(b, blocks.length > 1 ? `${t('mergeResolve.rendered.conflict')} — ${b}` : undefined))}</div>
    }
    if (model.insideConflict.has(n.key)) return <div className="min-w-0 px-3 py-1 bg-diff-conflict-bg/50" />
    const resolvedHere = model.rowResolved.get(n.key) ?? []
    const resolved = resolvedHere[0]
    const at = outputAt(model.output, n, model.nodes)
    let body: ReactNode
    if (!at) body = <span className="text-[11px] text-ink-3 italic">{t('diffView.absentUnit')}</span>
    else if (row.children.length > 0) body = null
    else body = <OutputValue node={n} value={at.value} presentation={p} typeDef={typeDef} repoPath={repoPath} onChange={v => onEdit(at.path, v)} />
    return (
      <div className={`min-w-0 px-3 py-1 ${resolved ? 'border-l-[3px] border-diff-resolved' : ''} ${at ? '' : 'diff-hatch'}`}>
        {resolvedHere.map(r => (
          <p key={r.key} className="text-[11px] text-ink-3 mb-1 flex items-center gap-2" data-resolved={r.key}>
            {labels.resolved[r.taken]}
            <button type="button" className={ACTION} onClick={() => onReset(r)}>{t('mergeResolve.reset')}</button>
          </p>
        ))}
        {body}
      </div>
    )
  }
  return (
    <Grid columns={1} treeWidth={treeWidth} header={(
      <>
        <HeaderCell>{t('treediff.structure')}</HeaderCell>
        <HeaderCell border>{labels.output}</HeaderCell>
      </>
    )}>
      {/* Blocks that name no row of the structure (rare): shown first. */}
      {model.unplaced.length > 0 && (
        <>
          <div className="border-r border-edge bg-canvas px-2 py-1 text-[11px] text-ink-3">{t('treediff.unplaced')}</div>
          <div className="min-w-0 flex flex-col gap-px">{model.unplaced.map(b => card(b, `${t('mergeResolve.rendered.conflict')} — ${b}`))}</div>
        </>
      )}
      {model.rows.map(row => (
        <div key={row.node.key} className="contents">
          <StructureCell row={row} model={model} />
          {cell(row)}
        </div>
      ))}
    </Grid>
  )
}

/** A complete number as typed (`3.6`, `-2`) — not `3.` or `-`, which are on their way to one. */
const NUMBER = /^-?\d+(\.\d+)?$/

/** Converts a widget string back to the YAML value, on every keystroke: by the schema type when
 *  there is one, else like the previous value. A number being typed stays text until it is one;
 *  a `multi_enum` stored as a list stays a list. */
function coerce(previous: unknown, s: string, field?: SchemaField): unknown {
  if (field) {
    if (s === '' && !field.required) return undefined
    if (field.type === 'number') return NUMBER.test(s) ? Number(s) : s
    if (field.type === 'boolean') return s === 'true'
    if (field.type === 'multi_enum' && Array.isArray(previous)) return parseMultiEnumValue(s)
    return s
  }
  if (typeof previous === 'number' && NUMBER.test(s)) return Number(s)
  if (typeof previous === 'boolean' && (s === 'true' || s === 'false')) return s === 'true'
  return s
}

function OutputValue({ node, value, presentation, typeDef, repoPath, onChange }: {
  node: DiffNode
  value: unknown
  presentation: Presentation
  typeDef?: ObjectTypeDefinition
  repoPath: string
  onChange: (v: unknown) => void
}) {
  const kind = presentation.render(node)
  const field = presentation.field(node)
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !field) {
    return <pre className="text-xs text-ink-2 font-mono whitespace-pre-wrap">{yaml.dump(value, { lineWidth: 120 }).trimEnd()}</pre>
  }
  // A YAML date is loaded as a `Date`: a date field's input takes `YYYY-MM-DD`.
  const asString = value === undefined || value === null ? ''
    : value instanceof Date ? (field?.type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString())
      : String(value)
  if (kind === 'status' && typeDef?.statuses?.length) {
    return (
      <select className="input-field" value={asString} onChange={e => onChange(e.target.value)}>
        {typeDef.statuses.map(s => <option key={s.name} value={s.name}>{s.label ?? s.name}</option>)}
      </select>
    )
  }
  if (field || kind === 'richtext') {
    const def = field ?? ({ name: '', label: '', type: 'richtext' } as SchemaField)
    return (
      <div className="[&>div>label:first-child]:hidden">
        <DynamicField field={{ ...def, label: '' }} value={field?.type === 'multi_enum' && Array.isArray(value) ? value.join(', ') : asString}
          repoPath={repoPath} onChange={s => onChange(coerce(value, s, field))} />
      </div>
    )
  }
  if (kind === 'text' || asString.includes('\n')) {
    return <textarea className="input-field w-full font-mono text-xs" rows={Math.min(8, asString.split('\n').length + 1)} value={asString}
      onChange={e => onChange(e.target.value)} />
  }
  return <input className="input-field w-full" value={asString} onChange={e => onChange(coerce(value, e.target.value))} />
}
