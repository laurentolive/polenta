import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * GH222 — habillage CodeMirror commun aux diffs Raw : les couleurs `diff-*` du thème (fond de ligne
 * plein, caractères changés plus soutenus, barre de gouttière) à la place du soulignement discret
 * de `@codemirror/merge`, zones d'alignement hachurées, régions inchangées repliées, et le bloc
 * courant de la navigation mis en relief.
 */

const v = (name: string) => `rgb(var(--diff-${name}))`
const hatch = `repeating-linear-gradient(135deg, transparent 0 4px, rgb(var(--diff-hatch) / 0.55) 4px 6px)`

export const diffTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'rgb(var(--canvas))', color: 'rgb(var(--ink-3))', borderRight: '1px solid rgb(var(--edge))' },
  '&.cm-focused': { outline: 'none' },
  // Côte à côte (`cm-merge-a` = Avant, `cm-merge-b` = Après) et en ligne (`cm-deletedChunk`).
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: v('line-del') },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: v('line-ins') },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: v('char-del'), borderRadius: '2px', textDecoration: 'line-through', textDecorationColor: 'rgb(var(--diff-gutter-del))',
  },
  '&.cm-merge-b .cm-changedText': { background: v('char-ins'), borderRadius: '2px' },
  '&.cm-merge-b .cm-deletedText': { background: v('char-del') },
  '.cm-changeGutter': { width: '4px', paddingLeft: '0' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: v('gutter-del') },
  '&.cm-merge-b .cm-changedLineGutter': { background: v('gutter-ins') },
  '.cm-collapsedLines': {
    color: 'rgb(var(--ink-3))', background: 'rgb(var(--canvas))', fontStyle: 'italic',
    borderTop: '1px dashed rgb(var(--edge))', borderBottom: '1px dashed rgb(var(--edge))',
  },
  '.cm-mergeSpacer': { backgroundImage: hatch },
  '.cm-diff-current': { boxShadow: 'inset 3px 0 0 rgb(var(--ink-2))' },
})

/** Highlight of the block the navigation is on: line range `[from, to]` (document positions). */
export const setCurrentBlock = StateEffect.define<{ from: number; to: number } | null>()

export const currentBlockField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setCurrentBlock)) return currentDecorations(tr.state, e.value)
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

function currentDecorations(state: EditorState, range: { from: number; to: number } | null): DecorationSet {
  if (!range) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const deco = Decoration.line({ class: 'cm-diff-current' })
  const first = state.doc.lineAt(Math.min(range.from, state.doc.length)).number
  const last = state.doc.lineAt(Math.min(Math.max(range.to - 1, range.from), state.doc.length)).number
  for (let n = first; n <= last; n++) builder.add(state.doc.line(n).from, state.doc.line(n).from, deco)
  return builder.finish()
}

export const diffExtensions: Extension[] = [diffTheme, currentBlockField]
