import { useEffect, useRef } from 'react'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration, EditorView, WidgetType, keymap, lineNumbers, type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { findRegions, unitAnchors, type Side } from '@polenta/merge-core'
import { programmaticScroller, ratioOf, type ScrollSyncGroup } from './scrollSync'

/**
 * GH37 — panneau Raw de l'éditeur de résolution (CodeMirror 6, design §3.2).
 *
 * - côtés (lecture seule) : `highlight` = lignes changées par ce côté depuis l'ancêtre commun ;
 * - sortie (éditable) : chaque région de marqueurs est colorée (gauche / droite / marqueurs) et
 *   précédée d'un widget « ← Prendre gauche · Prendre droite → » qui appelle `onResolve`.
 *
 * Le texte vit dans le parent (`value`) : une frappe remonte par `onChange`, une valeur changée de
 * l'extérieur (bouton de résolution, autre fichier) remplace le document de l'éditeur.
 */

interface Props {
  value: string
  readOnly?: boolean
  /** Coloration des lignes d'un côté : couleur du côté et index (0-based) des lignes changées. */
  highlight?: { side: Side; lines: Set<number> } | null
  onChange?: (text: string) => void
  onResolve?: (key: string, side: Side) => void
  labels?: { takeLeft: string; takeRight: string }
  yamlSyntax?: boolean
  /** Défilement synchronisé (sprint 2) : groupe, id du panneau, et ancrage par unité d'objet
   *  (`units`) ou simple position relative (fichier texte). */
  sync?: { group: ScrollSyncGroup; id: string; units: boolean }
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'rgb(var(--canvas))', color: 'rgb(var(--ink-3))', borderRight: '1px solid rgb(var(--edge))' },
  '.cm-content': { caretColor: 'rgb(var(--ink))' },
  '&.cm-focused': { outline: 'none' },
  '.cm-merge-left': { backgroundColor: 'rgb(var(--status-info-bg))' },
  '.cm-merge-right': { backgroundColor: 'rgb(var(--status-success-bg))' },
  '.cm-merge-marker': { backgroundColor: 'rgb(var(--status-warning-bg))', color: 'rgb(var(--status-warning))', fontWeight: '600' },
  '.cm-merge-actions': {
    display: 'flex', gap: '6px', padding: '2px 4px', fontFamily: 'system-ui, sans-serif',
    backgroundColor: 'rgb(var(--status-warning-bg))',
  },
  '.cm-merge-actions button': {
    fontSize: '11px', padding: '1px 8px', borderRadius: '4px', cursor: 'pointer',
    border: '1px solid rgb(var(--edge))', backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))',
  },
  '.cm-merge-actions button:hover': { backgroundColor: 'rgb(var(--surface-hover))' },
})

class ActionsWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly labels: { takeLeft: string; takeRight: string },
    readonly onResolve: (key: string, side: Side) => void,
  ) { super() }

  eq(other: ActionsWidget) { return other.key === this.key && other.labels === this.labels }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-merge-actions'
    const make = (label: string, side: Side) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      // mousedown kept from moving the editor's cursor/focus; the action itself on click.
      b.onmousedown = e => e.preventDefault()
      b.onclick = () => this.onResolve(this.key, side)
      wrap.appendChild(b)
    }
    make(this.labels.takeLeft, 'left')
    make(this.labels.takeRight, 'right')
    return wrap
  }

  ignoreEvent() { return true }
}

const lineClass = (cls: string) => Decoration.line({ class: cls })

/** Decorations of the conflict regions of the output document. */
function regionDecorations(
  state: EditorState,
  labels: Props['labels'],
  onResolve: Props['onResolve'],
): DecorationSet {
  const { regions } = findRegions(state.doc.toString())
  const ranges: Range<Decoration>[] = []
  for (const r of regions) {
    for (let i = r.start; i <= r.end; i++) {
      const line = state.doc.line(i + 1)
      if (i === r.start && labels && onResolve) {
        ranges.push(Decoration.widget({
          widget: new ActionsWidget(r.key, labels, onResolve), block: true, side: -1,
        }).range(line.from))
      }
      const cls = i === r.start || i === r.sep || i === r.end
        ? 'cm-merge-marker'
        : i < r.sep ? 'cm-merge-left' : 'cm-merge-right'
      ranges.push(lineClass(cls).range(line.from))
    }
  }
  return Decoration.set(ranges, true)
}

function highlightDecorations(state: EditorState, highlight: Props['highlight']): DecorationSet {
  if (!highlight) return Decoration.none
  const ranges: Range<Decoration>[] = []
  const cls = highlight.side === 'left' ? 'cm-merge-left' : 'cm-merge-right'
  for (let i = 0; i < state.doc.lines; i++) {
    if (highlight.lines.has(i)) {
      const line = state.doc.line(i + 1)
      ranges.push(lineClass(cls).range(line.from))
    }
  }
  return Decoration.set(ranges, true)
}

const setHighlight = StateEffect.define<Props['highlight']>()

export function RawPane({ value, readOnly = false, highlight, onChange, onResolve, labels, yamlSyntax = true, sync }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Latest callbacks, read by the (long-lived) editor extensions.
  const cb = useRef({ onChange, onResolve, labels })
  cb.current = { onChange, onResolve, labels }

  useEffect(() => {
    const resolve = (key: string, side: Side) => cb.current.onResolve?.(key, side)
    const highlightField = StateField.define<DecorationSet>({
      create: s => highlightDecorations(s, highlight),
      update: (deco, tr) => {
        for (const e of tr.effects) if (e.is(setHighlight)) return highlightDecorations(tr.state, e.value)
        return deco.map(tr.changes)
      },
      provide: f => EditorView.decorations.from(f),
    })
    const regionField = StateField.define<DecorationSet>({
      create: s => regionDecorations(s, cb.current.labels, resolve),
      update: (deco, tr) => (tr.docChanged ? regionDecorations(tr.state, cb.current.labels, resolve) : deco),
      provide: f => EditorView.decorations.from(f),
    })
    const extensions: Extension[] = [
      lineNumbers(),
      theme,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      highlightField,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]
    if (yamlSyntax) extensions.push(yaml())
    if (!readOnly) {
      extensions.push(
        regionField,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(u => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()) }),
      )
    }
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! })
    view.current = v
    const unsync = sync ? attachSync(v, sync) : () => {}
    return () => { unsync(); v.destroy(); view.current = null }
    // The editor is rebuilt only when its nature changes; value/highlight are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, yamlSyntax])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: setHighlight.of(highlight) })
  }, [highlight])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
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
