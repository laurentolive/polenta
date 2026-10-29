import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, StateEffect, StateField, Text, type Extension, type Range } from '@codemirror/state'
import {
  Decoration, EditorView, WidgetType, keymap, lineNumbers, type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { Chunk } from '@codemirror/merge'
import { canTakeBoth, findRegions, unitAnchors, type MarkerLabels, type Side } from '@polenta/merge-core'
import { programmaticScroller, ratioOf, type ScrollSyncGroup } from './scrollSync'
import { currentBlockField, setCurrentBlock } from '../diffkit/cmDiff'
import { OverviewRuler, type RulerMark, type RulerTone } from '../diffkit/OverviewRuler'
import { DIFF_CONFIG } from '../../lib/diffStats'
import { resolvedBlocks, type BlockFragments, type ResolvedBlock } from './blockLocator'

/**
 * GH37 — panneau Raw de l'éditeur de résolution (CodeMirror 6, design §3.2). GH222 :
 *
 * - côtés (lecture seule) : `against` = ce que ce côté a changé depuis l'ancêtre commun, ligne
 *   **et caractères** (`@codemirror/merge`), et au-dessus de chaque bloc encore en conflit
 *   l'action de ce côté (`actions`, « Prendre gauche » / « Prendre droite ») ;
 * - sortie (éditable) : chaque région de marqueurs est colorée et précédée de
 *   « Prendre gauche · Prendre droite · Prendre les deux » ; un bloc résolu est marqué, avec
 *   « Réinitialiser » ;
 * - partout : règle de vue d'ensemble, bloc courant de la navigation (`reveal`).
 *
 * Le texte vit dans le parent (`value`) : une frappe remonte par `onChange`, une valeur changée de
 * l'extérieur (bouton de résolution, autre fichier) remplace le document de l'éditeur.
 */

export interface PaneAction {
  key: string
  /** Ligne (0-based) au-dessus de laquelle l'action est posée. */
  line: number
  label: string
  run: () => void
}

export interface PaneLabels {
  takeLeft: string
  takeRight: string
  takeBoth: string
  reset: string
  resolved: Record<'left' | 'right' | 'both', string>
  ruler: string
}

interface Props {
  value: string
  readOnly?: boolean
  /** Côté : texte de l'ancêtre (`null` = fichier absent de l'ancêtre) et couleur du côté. */
  against?: { base: string | null; side: Side } | null
  onChange?: (text: string) => void
  onResolve?: (key: string, side: Side) => void
  onBoth?: (key: string) => void
  /** Sortie : blocs du merge initial, pour marquer ceux qui sont résolus (repérés dans le texte
   *  courant, au plus près de `hints`, la ligne où était leur région) et les réinitialiser. */
  blocks?: BlockFragments[]
  markerLabels?: MarkerLabels
  hints?: Map<string, number>
  onReset?: (block: ResolvedBlock) => void
  actions?: PaneAction[]
  labels: PaneLabels
  yamlSyntax?: boolean
  /** Défilement synchronisé (sprint 2) : groupe, id du panneau, et ancrage par unité d'objet
   *  (`units`) ou simple position relative (fichier texte). */
  sync?: { group: ScrollSyncGroup; id: string; units: boolean }
  /** Bloc courant de la navigation (lignes 0-based) ; un nouvel objet à chaque demande. */
  reveal?: { from: number; to: number } | null
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'rgb(var(--canvas))', color: 'rgb(var(--ink-3))', borderRight: '1px solid rgb(var(--edge))' },
  '.cm-content': { caretColor: 'rgb(var(--ink))' },
  '&.cm-focused': { outline: 'none' },
  // Ce qu'un côté a changé depuis l'ancêtre : fond de ligne, caractères, barre latérale.
  '.cm-side-left': { backgroundColor: 'rgb(var(--diff-left-line))', boxShadow: 'inset 3px 0 0 rgb(var(--diff-auto-left))' },
  '.cm-side-right': { backgroundColor: 'rgb(var(--diff-right-line))', boxShadow: 'inset 3px 0 0 rgb(var(--diff-auto-right))' },
  '.cm-side-left-char': { backgroundColor: 'rgb(var(--diff-left-char))', borderRadius: '2px' },
  '.cm-side-right-char': { backgroundColor: 'rgb(var(--diff-right-char))', borderRadius: '2px' },
  // Régions de conflit de la sortie.
  '.cm-merge-left': { backgroundColor: 'rgb(var(--diff-left-line))', boxShadow: 'inset 3px 0 0 rgb(var(--diff-conflict))' },
  '.cm-merge-right': { backgroundColor: 'rgb(var(--diff-right-line))', boxShadow: 'inset 3px 0 0 rgb(var(--diff-conflict))' },
  '.cm-merge-marker': {
    backgroundColor: 'rgb(var(--diff-conflict-bg))', color: 'rgb(var(--status-warning))', fontWeight: '600',
    boxShadow: 'inset 3px 0 0 rgb(var(--diff-conflict))',
  },
  '.cm-block-resolved': { boxShadow: 'inset 3px 0 0 rgb(var(--diff-resolved))' },
  '.cm-merge-actions': {
    display: 'flex', gap: '6px', alignItems: 'center', padding: '2px 6px', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '11px', borderTop: '1px solid rgb(var(--diff-conflict))', backgroundColor: 'rgb(var(--diff-conflict-bg))',
    color: 'rgb(var(--status-warning))',
  },
  '.cm-merge-actions.cm-merge-actions-resolved': {
    borderTop: '1px solid rgb(var(--edge))', backgroundColor: 'rgb(var(--canvas))', color: 'rgb(var(--ink-3))',
  },
  '.cm-merge-actions button': {
    color: 'rgb(var(--ink))', backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--edge))',
    borderRadius: '3px', padding: '0 6px', cursor: 'pointer',
  },
  '.cm-merge-actions button:hover': { backgroundColor: 'rgb(var(--surface-hover))' },
  '.cm-diff-current': { outline: '2px solid rgb(var(--ink-2))', outlineOffset: '-2px' },
})

/** What a button does — looked up in the pane's latest props when clicked, so a widget kept by
 *  CodeMirror across rebuilds never runs a handler from an older render. */
type Act =
  | { type: 'take'; key: string; side: Side }
  | { type: 'both'; key: string }
  | { type: 'reset'; key: string }
  | { type: 'side'; key: string }

interface ButtonSpec { label: string; act: Act }

class ActionsWidget extends WidgetType {
  constructor(
    readonly id: string, readonly text: string | null, readonly buttons: ButtonSpec[], readonly resolved: boolean,
    readonly run: (act: Act) => void,
  ) { super() }

  eq(other: ActionsWidget) {
    return other.id === this.id && other.text === this.text && other.resolved === this.resolved
      && other.buttons.map(b => b.label).join('|') === this.buttons.map(b => b.label).join('|')
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = this.resolved ? 'cm-merge-actions cm-merge-actions-resolved' : 'cm-merge-actions'
    wrap.dataset.block = this.id
    if (this.text) {
      const span = document.createElement('span')
      span.textContent = this.text
      wrap.appendChild(span)
    }
    for (const spec of this.buttons) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = spec.label
      // mousedown kept from moving the editor's cursor/focus; the action itself on click.
      b.onmousedown = e => e.preventDefault()
      b.onclick = () => this.run(spec.act)
      wrap.appendChild(b)
    }
    return wrap
  }

  ignoreEvent() { return true }
}

const lineClass = (cls: string) => Decoration.line({ class: cls })
const refresh = StateEffect.define<null>()

type Marked = { from: number; to: number; tone: RulerTone }

/** All decorations of a pane, from the latest props and the current document; `marked` collects
 *  the ruler's line ranges, `resolvedOut` the resolved blocks found. */
function buildDecorations(state: EditorState, p: Props, marked: Marked[], run: (act: Act) => void, resolvedOut: ResolvedBlock[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const lineFrom = (i: number) => doc.line(Math.min(i + 1, doc.lines)).from
  marked.length = 0

  if (p.against) {
    const tone = p.against.side
    const chunks = p.against.base === null
      ? [new Chunk([], 0, 0, 0, doc.length + 1)]
      : Chunk.build(Text.of(p.against.base.split('\n')), doc, DIFF_CONFIG)
    for (const c of chunks) {
      if (c.toB <= c.fromB) continue
      const first = doc.lineAt(c.fromB).number
      const last = doc.lineAt(Math.min(c.endB, doc.length)).number
      for (let n = first; n <= last; n++) ranges.push(lineClass(`cm-side-${tone}`).range(doc.line(n).from))
      for (const ch of c.changes) {
        const from = c.fromB + ch.fromB
        const to = Math.min(c.fromB + ch.toB, doc.length)
        if (to > from) ranges.push(Decoration.mark({ class: `cm-side-${tone}-char` }).range(from, to))
      }
      marked.push({ from: first - 1, to: last - 1, tone })
    }
  }

  resolvedOut.length = 0
  if (!p.readOnly) {
    const text = doc.toString()
    const { regions } = findRegions(text)
    for (const r of regions) {
      const buttons: ButtonSpec[] = []
      if (p.onResolve) {
        buttons.push({ label: p.labels.takeLeft, act: { type: 'take', key: r.key, side: 'left' } })
        buttons.push({ label: p.labels.takeRight, act: { type: 'take', key: r.key, side: 'right' } })
      }
      if (p.onBoth && canTakeBoth(text, r.key)) buttons.push({ label: p.labels.takeBoth, act: { type: 'both', key: r.key } })
      ranges.push(Decoration.widget({ widget: new ActionsWidget(`r:${r.key}:${r.start}`, null, buttons, false, run), block: true, side: -1 }).range(lineFrom(r.start)))
      for (let i = r.start; i <= r.end; i++) {
        const cls = i === r.start || i === r.sep || i === r.end ? 'cm-merge-marker' : i < r.sep ? 'cm-merge-left' : 'cm-merge-right'
        ranges.push(lineClass(cls).range(lineFrom(i)))
      }
      marked.push({ from: r.start, to: r.end, tone: 'conflict' })
    }
    const resolved = p.blocks && p.markerLabels ? resolvedBlocks(text, p.blocks, p.markerLabels, p.hints) : []
    resolvedOut.push(...resolved)
    for (const b of resolved) {
      if (b.to >= doc.lines) continue
      const buttons: ButtonSpec[] = p.onReset ? [{ label: p.labels.reset, act: { type: 'reset', key: b.key } }] : []
      ranges.push(Decoration.widget({ widget: new ActionsWidget(`s:${b.key}`, p.labels.resolved[b.taken], buttons, true, run), block: true, side: -1 }).range(lineFrom(b.from)))
      for (let i = b.from; i <= b.to; i++) ranges.push(lineClass('cm-block-resolved').range(lineFrom(i)))
      marked.push({ from: b.from, to: b.to, tone: 'resolved' })
    }
  }

  for (const a of p.actions ?? []) {
    if (a.line >= doc.lines) continue
    ranges.push(Decoration.widget({ widget: new ActionsWidget(`a:${a.key}`, null, [{ label: a.label, act: { type: 'side', key: a.key } }], false, run), block: true, side: -1 }).range(lineFrom(a.line)))
  }
  return Decoration.set(ranges, true)
}

export function RawPane(props: Props) {
  const { value, readOnly = false, yamlSyntax = true, sync, reveal } = props
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Latest props, read by the (long-lived) editor extensions.
  const cb = useRef(props)
  cb.current = props
  const marked = useRef<Marked[]>([])
  const resolvedNow = useRef<ResolvedBlock[]>([])
  const [marks, setMarks] = useState<RulerMark[]>([])
  // Buttons act on the latest props (and the resolved blocks of the current document).
  const [run] = useState(() => (act: Act) => {
    const p = cb.current
    if (act.type === 'take') p.onResolve?.(act.key, act.side)
    else if (act.type === 'both') p.onBoth?.(act.key)
    else if (act.type === 'side') p.actions?.find(a => a.key === act.key)?.run()
    else {
      const found = resolvedNow.current.find(r => r.key === act.key)
      if (found) p.onReset?.(found)
    }
  })

  const measure = useCallback(() => {
    const v = view.current
    if (!v) return
    const total = v.scrollDOM.scrollHeight
    if (total === 0) return
    const doc = v.state.doc
    const next = marked.current.map(m => {
      const top = v.lineBlockAt(doc.line(Math.min(m.from + 1, doc.lines)).from).top
      const bottom = v.lineBlockAt(doc.line(Math.min(m.to + 1, doc.lines)).from).bottom
      return { top: top / total, height: (bottom - top) / total, tone: m.tone }
    })
    // Geometry changes on most scroll frames: re-render only when a mark moved.
    setMarks(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])

  useEffect(() => {
    const decoField = StateField.define<DecorationSet>({
      create: s => buildDecorations(s, cb.current, marked.current, run, resolvedNow.current),
      update: (deco, tr) => (tr.docChanged || tr.effects.some(e => e.is(refresh))
        ? buildDecorations(tr.state, cb.current, marked.current, run, resolvedNow.current)
        : deco),
      provide: f => EditorView.decorations.from(f),
    })
    const extensions: Extension[] = [
      lineNumbers(),
      theme,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      decoField,
      currentBlockField,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.updateListener.of(u => { if (u.geometryChanged || u.docChanged) requestAnimationFrame(measure) }),
    ]
    if (yamlSyntax) extensions.push(yaml())
    if (!readOnly) {
      extensions.push(
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(u => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()) }),
      )
    }
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! })
    view.current = v
    const unsync = sync ? attachSync(v, sync) : () => {}
    requestAnimationFrame(measure)
    return () => { unsync(); v.destroy(); view.current = null }
    // The editor is rebuilt only when its nature changes; value/decorations are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, yamlSyntax])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    // The whole document is replaced: the navigation's current block no longer applies.
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value }, effects: setCurrentBlock.of(null) })
  }, [value])

  // Decorations that depend on props other than the text.
  useEffect(() => {
    view.current?.dispatch({ effects: refresh.of(null) })
    requestAnimationFrame(measure)
  }, [props.against, props.blocks, props.hints, props.actions, props.labels, measure])

  useEffect(() => {
    const v = view.current
    if (!v || !reveal) return
    const doc = v.state.doc
    const from = doc.line(Math.min(reveal.from + 1, doc.lines)).from
    const to = doc.line(Math.min(reveal.to + 1, doc.lines)).to
    v.dispatch({ effects: [setCurrentBlock.of({ from, to }), EditorView.scrollIntoView(from, { y: 'start', yMargin: 40 })] })
  }, [reveal])

  const jump = (i: number) => {
    const v = view.current
    const m = marked.current[i]
    if (!v || !m) return
    const doc = v.state.doc
    v.dispatch({ effects: EditorView.scrollIntoView(doc.line(Math.min(m.from + 1, doc.lines)).from, { y: 'start', yMargin: 40 }) })
  }

  return (
    <div className="relative h-full min-h-0">
      <div ref={host} className="h-full min-h-0 overflow-hidden pr-2.5" />
      <OverviewRuler marks={marks} onJump={jump} label={props.labels.ruler} />
    </div>
  )
}

/** Publishes this editor's scroll anchor to the group, and follows the others'. */
function attachSync(v: EditorView, sync: NonNullable<Props['sync']>): () => void {
  const el = v.scrollDOM
  const scroller = programmaticScroller()
  let cachedDoc: unknown = null
  let cached: { key: string; line: number }[] = []
  const anchors = () => {
    if (!sync.units) return []
    if (cachedDoc !== v.state.doc) { cachedDoc = v.state.doc; cached = unitAnchors(v.state.doc.toString()) }
    return cached
  }
  const onScroll = () => {
    if (scroller.isEcho(el)) return
    const block = v.lineBlockAtHeight(el.scrollTop)
    const line = v.state.doc.lineAt(block.from).number - 1
    let anchor: { key: string; line: number } | null = null
    for (const a of anchors()) { if (a.line <= line) anchor = a; else break }
    sync.group.publish(sync.id, { key: anchor?.key ?? null, offset: anchor ? line - anchor.line : 0, ratio: ratioOf(el) })
  }
  el.addEventListener('scroll', onScroll, { passive: true })
  const unregister = sync.group.register(sync.id, {
    scrollTo(target) {
      const list = anchors()
      const i = target.key ? list.findIndex(a => a.key === target.key) : -1
      if (i < 0) {
        scroller.set(el, target.ratio * (el.scrollHeight - el.clientHeight))
        return
      }
      const span = i + 1 < list.length ? list[i + 1].line - list[i].line - 1 : target.offset
      const line = list[i].line + Math.min(target.offset, Math.max(0, span))
      const pos = v.state.doc.line(Math.min(line + 1, v.state.doc.lines)).from
      scroller.set(el, v.lineBlockAt(pos).top)
    },
  })
  return () => { el.removeEventListener('scroll', onScroll); unregister() }
}
