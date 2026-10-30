import yaml from 'js-yaml'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react'
import { diffTree, type DiffNode, type StructureDesc } from '@polenta/merge-core'
import type { ObjectTypeDefinition } from '@polenta/types'
import { RawValue, RichText, WordDiffText } from '../diff/DiffValue'
import { useMediaDiff, type MediaChanges } from '../diff/useMediaDiff'
import { scalarLabel, statusLabel } from '../../lib/objectUnits'
import { diffPrefs } from '../../lib/diffPrefs'
import { OverviewRuler, type RulerMark } from '../diffkit/OverviewRuler'
import { NavBar } from '../diffkit/NavBar'
import { useChangeNavigation } from '../diffkit/useChangeNavigation'
import type { Presentation } from './presentation'
import { OutputValue } from './TreeMerge'
import { addUnder, restoreRow, setRowValue } from './draftEdit'

/**
 * GH222 — vue générique d'un diff (spec §4.1) : à gauche la colonne **Structure** (arbre repliable,
 * seule porteuse de la profondeur), à droite une colonne par version, **une rangée par nœud visible**,
 * toutes les valeurs à la même position X. Une seule grille CSS : l'alignement des rangées est
 * garanti sans mesure. Navigation (`F7`) et règle de vue d'ensemble sur les changements.
 */

export interface TreeSide {
  value: unknown
  /** Version git (images, diagrammes), `null` = working tree. */
  at: string | null
  label: string
  typeDef?: ObjectTypeDefinition
}

const INDENT = 12
const MAX_INDENT_LEVELS = 6

type Row =
  | { type: 'node'; node: DiffNode; depth: number; children: DiffNode[]; expanded: boolean; trail: string }
  | { type: 'fold'; depth: number; keys: string[] }

/** GH222 §12 — côté Après modifiable : texte du brouillon, style YAML du fichier, mise à jour. */
export interface TreeEdit {
  text: string
  style: yaml.DumpOptions
  onChange: (text: string) => void
}

export function TreeDiffView({ before, after, presentation, desc, repoPath, hideUnchanged, navSlot, testId = 'tree-diff', edit }: {
  before: TreeSide
  after: TreeSide
  presentation: Presentation
  desc?: StructureDesc
  repoPath: string
  hideUnchanged: boolean
  navSlot?: HTMLElement | null
  testId?: string
  edit?: TreeEdit
}) {
  const { t } = useTranslation()
  const root = useMemo(() => diffTree(before.value, after.value, desc), [before.value, after.value, desc])
  const p = presentation
  const nodes = useMemo(() => {
    const m = new Map<string, DiffNode>()
    const walk = (n: DiffNode) => { m.set(n.key, n); n.children?.forEach(walk) }
    walk(root)
    return m
  }, [root])
  /** Applies an edit of the draft (`null` = no place for it: nothing changes). */
  const apply = (next: string | null) => { if (next !== null && edit) edit.onChange(next) }

  // Richtexts are also compared on the media they reference (a diagram changed at the other version).
  const richTexts = useMemo(() => {
    const out: Array<{ key: string; before: string; after: string }> = []
    const walk = (n: DiffNode) => {
      if (p.render(n) === 'richtext' && !n.children) {
        const [b, a] = [n.hasBefore ? n.before : undefined, n.hasAfter ? n.after : undefined]
        if (typeof b === 'string' || typeof a === 'string') out.push({ key: n.key, before: typeof b === 'string' ? b : '', after: typeof a === 'string' ? a : '' })
      }
      n.children?.forEach(walk)
    }
    walk(root)
    return out
  }, [root, p])
  const media = useMediaDiff(richTexts, repoPath, before.at, after.at)

  // Changed nodes — by their state, or by the media they reference (a node whose YAML is the same
  // but whose diagram changed) — with their ancestors, and the changed leaves of each subtree
  // (`changedCount` of diffTree knows neither the media nor the hidden nodes).
  const { changed, leaves } = useMemo(() => {
    const changedSet = new Set<string>()
    const leavesBy = new Map<string, number>()
    const visit = (n: DiffNode): number => {
      if (p.hidden(n)) return 0
      const m = media.get(n.key)
      const self = n.state !== 'unchanged' || (m?.before.size ?? 0) > 0 || (m?.after.size ?? 0) > 0
      const kids = p.leaf(n) ? [] : n.children ?? []
      let count = kids.length ? kids.reduce((s, c) => s + visit(c), 0) : self ? 1 : 0
      if (self && kids.length && count === 0) count = 1
      if (self || count > 0) changedSet.add(n.key)
      leavesBy.set(n.key, count)
      return count
    }
    visit(root)
    return { changed: changedSet, leaves: leavesBy }
  }, [root, media, p])

  // Folding: changed nodes open by default, the rest closed; the user's toggles override.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const isExpanded = useCallback((n: DiffNode) => toggled.get(n.key) ?? changed.has(n.key), [toggled, changed])

  const rows = useMemo(() => {
    const out: Row[] = []
    const childrenOf = (n: DiffNode) => (p.leaf(n) ? [] : p.order(n, (n.children ?? []).filter(c => !p.hidden(c))))
    const walk = (parent: DiffNode, depth: number, trail: string) => {
      const kids = childrenOf(parent)
      let fold: string[] = []
      const flush = () => { if (fold.length) out.push({ type: 'fold', depth, keys: fold }); fold = [] }
      for (const c of kids) {
        if (hideUnchanged && !changed.has(c.key) && !revealed.has(c.key)) { fold.push(c.key); continue }
        flush()
        const children = childrenOf(c)
        const expanded = children.length > 0 && isExpanded(c)
        // Full path of the node, as the Structure column names it (its tooltip).
        const here = trail ? `${trail} › ${p.label(c)}` : p.label(c)
        out.push({ type: 'node', node: c, depth, children, expanded, trail: here })
        if (expanded) walk(c, depth + 1, here)
      }
      flush()
    }
    walk(root, 0, '')
    return out
  }, [root, p, hideUnchanged, changed, revealed, isExpanded])

  // ─── Navigation : les feuilles changées visibles ──────────────────────────────────
  const navRows = useMemo(() => rows.flatMap((r, i) => (r.type === 'node' && changed.has(r.node.key) && !r.expanded ? [i] : [])), [rows, changed])
  const box = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const go = (i: number) => {
    const r = rows[navRows[i]]
    if (r?.type !== 'node') return
    setCurrent(r.node.key)
    box.current?.querySelector(`[data-row-key="${CSS.escape(r.node.key)}"]`)?.scrollIntoView({ block: 'center' })
  }
  const navKey = navRows.join(',')
  const nav = useChangeNavigation(navRows.length, go, { listKey: navKey })
  // The navigation starts over when its list changes (a node folded or unfolded): so does its mark.
  useEffect(() => { setCurrent(null) }, [navKey])

  const [marks, setMarks] = useState<RulerMark[]>([])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const total = el.scrollHeight
      if (!total) return
      const next = navRows.flatMap(i => {
        const r = rows[i]
        if (r.type !== 'node') return []
        const cell = el.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(r.node.key)}"]`)
        if (!cell) return []
        const tone: RulerMark['tone'] = r.node.state === 'added' ? 'ins' : r.node.state === 'removed' ? 'del' : 'mod'
        return [{ top: cell.offsetTop / total, height: cell.offsetHeight / total, tone }]
      })
      setMarks(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el.firstElementChild ?? el)
    return () => ro.disconnect()
  }, [rows, navRows])

  // ─── Largeur de la colonne Structure ─────────────────────────────────────────────
  const [treeWidth, setTreeWidth] = useState(diffPrefs.treeWidth)
  // A drag in progress is dropped if the view goes away (other file, other route).
  const stopDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDrag.current?.(), [])
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = treeWidth
    let last = w0
    const move = (ev: PointerEvent) => { last = Math.max(120, Math.min(480, w0 + ev.clientX - x0)); setTreeWidth(last) }
    const detach = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stopDrag.current = null
    }
    const up = () => { detach(); diffPrefs.setTreeWidth(last) }
    stopDrag.current = detach
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggle = (n: DiffNode) => setToggled(prev => new Map(prev).set(n.key, !isExpanded(n)))

  const valueCell = (r: Extract<Row, { type: 'node' }>, side: 'before' | 'after') => {
    const n = r.node
    const has = side === 'before' ? n.hasBefore : n.hasAfter
    const s = side === 'before' ? before : after
    const isChanged = changed.has(n.key)
    const border = side === 'after' ? 'border-l border-edge' : ''
    // GH222 §12 — « ← Rétablir » on a row the local change touched (its value of Avant comes back).
    const restore = edit && side === 'after' && n.state !== 'unchanged'
      ? (
        <button type="button" className="cm-diff-restore mb-1 mr-1" data-restore={n.key}
          onClick={() => apply(restoreRow(edit.text, n, nodes, edit.style))}>
          ← {t('diffView.restore')}
        </button>
      )
      : null
    if (!has) {
      return (
        <div className={`diff-hatch min-w-0 px-3 py-1 ${border}`} data-absent>
          {restore}
          <span className="text-[11px] text-ink-3 italic">{t('diffView.absentUnit')}</span>
        </div>
      )
    }
    const tone = !isChanged ? '' : side === 'before' ? 'bg-diff-line-del' : 'bg-diff-line-ins'
    let body: ReactNode
    if (r.children.length > 0) {
      body = r.expanded
        ? null
        : <span className="text-[11px] text-ink-3">{t('treediff.summary', { count: r.children.length, changed: leaves.get(n.key) ?? 0 })}</span>
    } else if (edit && side === 'after') {
      body = <OutputValue node={n} value={n.after} presentation={p} typeDef={after.typeDef} repoPath={repoPath}
        onChange={v => apply(setRowValue(edit.text, n, nodes, v, edit.style))} />
    } else {
      const v = side === 'before' ? n.before : n.after
      const other = isChanged && n.hasBefore && n.hasAfter ? (side === 'before' ? n.after : n.before) : undefined
      body = <Value node={n} value={v} other={other} side={side} presentation={p} typeDef={s.typeDef ?? after.typeDef}
        media={media.get(n.key)?.[side]} repoPath={repoPath} at={s.at} />
    }
    // « + Ajouter » under a list or a mapping of the edited side.
    const add = edit && side === 'after' && (n.kind === 'list' || n.kind === 'map') && !p.leaf(n)
      ? <AddControl kind={n.kind} onAdd={key => apply(addUnder(edit.text, n, nodes, edit.style, key))} />
      : null
    return (
      <div className={`min-w-0 px-3 ${r.children.length && r.expanded ? 'py-0.5' : 'py-1'} ${border} ${tone}`}>
        {restore}
        {add}
        {n.state === 'moved' && (
          <p className="text-[11px] text-ink-3 flex items-center gap-1"><ArrowLeftRight size={11} />{side === 'before' ? t('treediff.movedTo') : t('treediff.movedFrom')}</p>
        )}
        {body}
      </div>
    )
  }

  const structureCell = (r: Extract<Row, { type: 'node' }>) => {
    const n = r.node
    const level = Math.min(r.depth, MAX_INDENT_LEVELS)
    const isChanged = changed.has(n.key)
    const dot = !isChanged ? '' : n.state === 'added' ? 'bg-diff-gutter-ins' : n.state === 'removed' ? 'bg-diff-gutter-del' : 'bg-diff-auto-left'
    return (
      <div
        className={`min-w-0 flex items-start gap-1 py-1 pr-1 text-xs text-ink-2 border-r border-edge bg-canvas relative ${current === n.key ? 'ring-2 ring-inset ring-ink-2' : ''}`}
        style={{ paddingLeft: 4 + level * INDENT }}
        title={r.trail}
        data-row-key={n.key}
        data-unit={p.unitKey(n)}
        data-step-row={p.stepRow(n)}
        data-changed={isChanged || undefined}
        data-depth={r.depth}
      >
        {/* Filets de niveau (plafonnés comme l'indentation). */}
        {Array.from({ length: level }, (_, i) => (
          <span key={i} aria-hidden className="absolute top-0 bottom-0 border-l border-edge-subtle" style={{ left: 9 + i * INDENT }} />
        ))}
        {r.children.length > 0
          ? (
            <button type="button" className="shrink-0 text-ink-3 hover:text-ink mt-px" onClick={() => toggle(n)}
              aria-expanded={r.expanded} aria-label={r.expanded ? t('treediff.collapse') : t('treediff.expand')}>
              {r.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )
          : <span className="w-3 shrink-0" />}
        <span className="truncate flex-1 min-w-0">{p.label(n)}</span>
        {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${dot}`} aria-hidden />}
      </div>
    )
  }

  const absentFile = before.value === undefined || after.value === undefined
  return (
    <div className="relative h-full min-h-0">
      <div ref={box} className="h-full overflow-auto pr-2.5" data-testid={testId}>
        <div className="grid min-w-0" style={{ gridTemplateColumns: `${treeWidth}px minmax(0, 1fr) minmax(0, 1fr)` }}>
          <div className="sticky top-0 z-10 px-2 py-1 bg-canvas border-b border-r border-edge text-[11px] uppercase tracking-wide text-ink-3 relative">
            {t('treediff.structure')}
            <span role="separator" aria-orientation="vertical" onPointerDown={startResize}
              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-ink-3" data-testid="tree-resize" />
          </div>
          <ColumnTitle>{before.label}</ColumnTitle>
          <ColumnTitle border>{after.label}</ColumnTitle>
          {absentFile && (
            <>
              <div className="border-r border-edge bg-canvas" />
              <AbsentNotice show={before.value === undefined} />
              <AbsentNotice show={after.value === undefined} border />
            </>
          )}
          {rows.map(r => (r.type === 'node'
            ? (
              <div key={r.node.key} className="contents" data-node={r.node.key} data-state={r.node.state}>
                {structureCell(r)}
                {valueCell(r, 'before')}
                {valueCell(r, 'after')}
              </div>
            )
            : (
              <button key={`fold:${r.keys[0]}`} type="button"
                className="col-span-3 py-0.5 text-[11px] text-ink-3 hover:bg-hover border-t border-edge-subtle flex items-center gap-1 text-left"
                style={{ paddingLeft: 4 + Math.min(r.depth, MAX_INDENT_LEVELS) * INDENT }}
                onClick={() => setRevealed(prev => new Set([...prev, ...r.keys]))}>
                <ChevronRight size={12} />
                {t('diffView.unchangedCount', { count: r.keys.length })}
              </button>
            )))}
        </div>
      </div>
      <OverviewRuler marks={marks} current={nav.index} onJump={nav.moveTo} label={t('diffkit.change.ruler')} />
      {navSlot && createPortal(<NavBar index={nav.index} count={navRows.length} onPrev={nav.prev} onNext={nav.next} />, navSlot)}
    </div>
  )
}

export function Value({ node, value, other, side, presentation, typeDef, media, repoPath, at }: {
  node: DiffNode
  value: unknown
  other?: unknown
  side: 'before' | 'after'
  presentation: Presentation
  typeDef?: ObjectTypeDefinition
  media?: MediaChanges['before']
  repoPath: string
  at: string | null
}) {
  const { t } = useTranslation()
  if (value === null || value === undefined || value === '') return <span className="text-xs text-ink-3 italic">{t('treediff.empty')}</span>
  const otherText = typeof other === 'string' ? other : undefined
  const kind = presentation.render(node)
  const field = presentation.field(node)
  if (field?.type === 'link') return <span className="text-sm text-ink whitespace-pre-wrap">{scalarLabel(field, value)}</span>
  if (field?.type === 'enum' || field?.type === 'multi_enum') return <span className="text-sm text-ink">{scalarLabel(field, value)}</span>
  // A container shown as one value: its type differs on the other side (scalar → list…), or it
  // is an empty list / mapping — its content as YAML.
  if (typeof value === 'object' && !(value instanceof Date)) return <RawValue value={value} />
  switch (kind) {
    case 'status':
      return <span className="text-sm text-ink">{statusLabel(typeDef, value)}</span>
    case 'richtext':
      return typeof value === 'string'
        ? <RichText value={value} other={otherText} side={side} media={media} repoPath={repoPath} at={at} />
        : <span className="text-sm text-ink">{String(value)}</span>
    case 'title':
      return <span className="text-sm font-semibold text-ink"><WordDiffText text={String(value)} other={otherText} side={side} /></span>
    case 'field': {
      const text = value instanceof Date ? value.toISOString() : String(value)
      return <span className="text-sm text-ink whitespace-pre-wrap break-words"><WordDiffText text={text} other={otherText} side={side} /></span>
    }
    default:
      return <span className="text-sm text-ink whitespace-pre-wrap break-words font-mono"><WordDiffText text={String(value)} other={otherText} side={side} /></span>
  }
}

/** « + Ajouter » : an element (list) at once, or a key to type first (mapping). */
function AddControl({ kind, onAdd }: { kind: 'list' | 'map'; onAdd: (key?: string) => void }) {
  const { t } = useTranslation()
  const [key, setKey] = useState<string | null>(null)
  if (kind === 'list' || key === null) {
    return (
      <button type="button" className="cm-diff-restore mb-1 mr-1" data-add
        onClick={() => (kind === 'list' ? onAdd() : setKey(''))}>
        + {t('diffView.add')}
      </button>
    )
  }
  // Enter / Escape settle the input; the blur that follows when it unmounts must not add again.
  const finish = (add: boolean) => {
    if (key === null) return
    if (add && key.trim()) onAdd(key.trim())
    setKey(null)
  }
  return (
    <input autoFocus className="input-field text-xs mb-1" placeholder={t('diffView.newKey')} value={key}
      onChange={e => setKey(e.target.value)} onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        if (e.key === 'Escape') { e.preventDefault(); setKey(null) }
      }} />
  )
}

function ColumnTitle({ children, border }: { children: ReactNode; border?: boolean }) {
  return (
    <div className={`sticky top-0 z-10 px-3 py-1 bg-canvas border-b border-edge text-[11px] uppercase tracking-wide text-ink-3 truncate ${border ? 'border-l' : ''}`}>
      {children}
    </div>
  )
}

function AbsentNotice({ show, border }: { show: boolean; border?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={`px-3 py-2 ${border ? 'border-l border-edge' : ''}`}>
      {show && <p className="text-xs text-ink-3 italic">{t('diffView.absentFile')}</p>}
    </div>
  )
}
