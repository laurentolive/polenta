import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { MergeView, getChunks, unifiedMergeView, type Chunk } from '@codemirror/merge'
import { DIFF_CONFIG } from '../../lib/diffStats'
import { diffExtensions, setCurrentBlock } from '../diffkit/cmDiff'
import { OverviewRuler, type RulerMark } from '../diffkit/OverviewRuler'
import { NavBar } from '../diffkit/NavBar'
import { useChangeNavigation } from '../diffkit/useChangeNavigation'

/**
 * GH222 — mode Raw des vues de diff (remplace `LineDiffView`, plafonné à 2 000 lignes) :
 * `@codemirror/merge`, côte à côte (`MergeView`) ou en ligne (`unifiedMergeView`), lecture seule.
 * Fond plein des lignes changées, caractères changés surlignés, barre de gouttière, alignement
 * hachuré, régions inchangées repliées, règle de vue d'ensemble et navigation (`F7`).
 */

const COLLAPSE = { margin: 3, minSize: 4 }
/** A change of the edited side that comes from outside the editor (save, reload, Rendu). */
const fromOutside = Annotation.define<boolean>()

function baseExtensions(yamlSyntax: boolean, editable = false): Extension[] {
  const ext: Extension[] = [
    lineNumbers(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    ...diffExtensions,
  ]
  if (editable) ext.push(history(), keymap.of([...defaultKeymap, ...historyKeymap]))
  if (yamlSyntax) ext.push(yaml())
  return ext
}

type Handle =
  | { layout: 'side'; view: MergeView }
  | { layout: 'inline'; view: EditorView }

function toneOf(c: Chunk): RulerMark['tone'] {
  if (c.fromA === c.toA) return 'ins'
  if (c.fromB === c.toB) return 'del'
  return 'mod'
}

export function RawDiffView({ before, after, layout, yamlSyntax, navBarSlot, onChange }: {
  before: string
  after: string
  layout: 'side' | 'inline'
  yamlSyntax: boolean
  /** Où monter la barre de navigation (sous-en-tête de la vue). */
  navBarSlot?: HTMLElement | null
  /** GH222 §12 — côté Après modifiable (modification locale) : texte édité, « ← Rétablir » par bloc. */
  onChange?: (text: string) => void
}) {
  const { t } = useTranslation()
  const editable = !!onChange
  const latest = useRef({ onChange, after })
  latest.current = { onChange, after }
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<Handle | null>(null)
  const [chunks, setChunks] = useState<readonly Chunk[]>([])
  const [marks, setMarks] = useState<RulerMark[]>([])

  const scroller = () => {
    const h = handle.current
    if (!h) return null
    return h.layout === 'side' ? h.view.dom : h.view.scrollDOM
  }

  const measure = useCallback(() => {
    const h = handle.current
    const el = scroller()
    if (!h || !el || el.scrollHeight === 0) return
    const list = h.layout === 'side' ? h.view.chunks : getChunks(h.view.state)?.chunks ?? []
    setChunks(prev => (prev.length === list.length && prev.every((c, i) => c === list[i]) ? prev : list))
    const total = el.scrollHeight
    const offset = (v: EditorView) => v.documentTop - el.getBoundingClientRect().top + el.scrollTop
    const next = list.map(c => {
      const v = h.layout === 'side' ? h.view.b : h.view
      const pos = Math.min(c.fromB, v.state.doc.length)
      const top = offset(v) + v.lineBlockAt(pos).top
      const end = Math.min(c.endB, v.state.doc.length)
      const bottom = offset(v) + v.lineBlockAt(end).bottom
      return { top: top / total, height: Math.max(0, bottom - top) / total, tone: toneOf(c) }
    })
    // Geometry changes on most scroll frames: re-render only when a mark moved.
    setMarks(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])

  useEffect(() => {
    const parent = host.current!
    const listener = EditorView.updateListener.of(u => { if (u.geometryChanged || u.docChanged) requestAnimationFrame(measure) })
    // The edited side reports its text (a typed change or « ← Rétablir »).
    const changes = EditorView.updateListener.of(u => {
      if (u.docChanged && !u.transactions.some(tr => tr.annotation(fromOutside))) latest.current.onChange?.(u.state.doc.toString())
    })
    // Built from the current text; later edits come from the editor itself (below for outside ones).
    const doc = latest.current.after
    if (layout === 'side') {
      const view = new MergeView({
        a: { doc: before, extensions: [...baseExtensions(yamlSyntax), listener] },
        b: { doc, extensions: [...baseExtensions(yamlSyntax, editable), listener, ...(editable ? [changes] : [])] },
        parent,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: COLLAPSE,
        diffConfig: DIFF_CONFIG,
        ...(editable ? { revertControls: 'a-to-b' as const, renderRevertControl: () => revertButton(t('diffView.restore')) } : {}),
      })
      view.dom.style.height = '100%'
      view.dom.style.overflow = 'auto'
      handle.current = { layout, view }
    } else {
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            ...baseExtensions(yamlSyntax, editable),
            listener,
            ...(editable ? [changes] : []),
            unifiedMergeView({
              original: before,
              // Editable: « Rétablir » (reject = back to Avant) only; accepting a local change is a no-op.
              mergeControls: editable
                ? (type, action) => (type === 'reject' ? revertButton(t('diffView.restore'), action) : document.createElement('span'))
                : false,
              gutter: true, highlightChanges: true, collapseUnchanged: COLLAPSE, diffConfig: DIFF_CONFIG,
            }),
          ],
        }),
      })
      handle.current = { layout, view }
    }
    const ro = new ResizeObserver(() => measure())
    ro.observe(parent)
    requestAnimationFrame(measure)
    return () => {
      ro.disconnect()
      handle.current?.view.destroy()
      handle.current = null
    }
    // `after` is read at creation only when editable: the editor owns the text from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before, editable ? null : after, layout, yamlSyntax, editable, measure])

  // An outside change of the edited text (« Recharger », an edit in Rendu): the editor follows.
  useEffect(() => {
    const h = handle.current
    if (!editable || !h) return
    const v = h.layout === 'side' ? h.view.b : h.view
    const current = v.state.doc.toString()
    // Not reported back as an edit: after a save, the old text shown until the re-read must not
    // become a draft again.
    if (current !== after) v.dispatch({ changes: { from: 0, to: current.length, insert: after }, annotations: fromOutside.of(true) })
  }, [after, editable])

  const go = useCallback((i: number) => {
    const h = handle.current
    const c = (h?.layout === 'side' ? h.view.chunks : h ? getChunks(h.view.state)?.chunks : undefined)?.[i]
    if (!h || !c) return
    if (h.layout === 'side') {
      // The side holding lines carries the highlight (Après, or Avant for a pure deletion).
      const [mine, other] = c.fromB === c.toB ? [h.view.a, h.view.b] : [h.view.b, h.view.a]
      const [from, to] = mine === h.view.a ? [c.fromA, c.endA] : [c.fromB, c.endB]
      other.dispatch({ effects: setCurrentBlock.of(null) })
      mine.dispatch({ effects: [setCurrentBlock.of({ from, to }), EditorView.scrollIntoView(Math.min(from, mine.state.doc.length), { y: 'center' })] })
    } else {
      const pos = Math.min(c.fromB, h.view.state.doc.length)
      h.view.dispatch({ effects: [setCurrentBlock.of({ from: pos, to: Math.min(c.endB, h.view.state.doc.length) }), EditorView.scrollIntoView(pos, { y: 'center' })] })
    }
  }, [])

  const nav = useChangeNavigation(chunks.length, go)

  return (
    <div className="relative h-full min-h-0" data-testid="raw-diff" data-layout={layout}>
      <div ref={host} className="h-full min-h-0 overflow-hidden pr-2.5 [&_.cm-editor]:h-full" />
      <OverviewRuler marks={marks} current={nav.index} onJump={nav.moveTo} label={t('diffkit.change.ruler')} />
      {navBarSlot !== undefined && <NavSlot slot={navBarSlot}>
        <NavBar index={nav.index} count={chunks.length} onPrev={nav.prev} onNext={nav.next} />
      </NavSlot>}
    </div>
  )
}

function NavSlot({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return slot ? createPortal(children, slot) : null
}

/** « ← Rétablir » : takes the block of Avant back (revert control of `@codemirror/merge`). */
function revertButton(label: string, action?: (e: MouseEvent) => void): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-diff-restore'
  b.textContent = `← ${label}`
  b.title = label
  if (action) b.onmousedown = e => { e.preventDefault(); action(e) }
  return b
}
