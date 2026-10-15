import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'

/**
 * GH74 — éditeur de code de la vue Suivi (CodeMirror 6) : script de données / transformation (JS)
 * et spec Vega-Lite (JSON). Le texte vit dans le parent : frappe → `onChange` ; valeur changée de
 * l'extérieur (modèle régénéré, autre requête) → document remplacé.
 */

interface Props {
  value: string
  onChange?: (text: string) => void
  language: 'javascript' | 'json'
  readOnly?: boolean
  /** Hauteur minimale (px). */
  minHeight?: number
  /** Ligne signalée en erreur (1-based), mise en évidence. */
  errorLine?: number | null
  ariaLabel?: string
}

const theme = EditorView.theme({
  '&': { fontSize: '12px', backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))', border: '1px solid rgb(var(--edge))', borderRadius: '6px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto', maxHeight: '420px' },
  '.cm-gutters': { backgroundColor: 'rgb(var(--canvas))', color: 'rgb(var(--ink-3))', borderRight: '1px solid rgb(var(--edge))' },
  '.cm-content': { caretColor: 'rgb(var(--ink))' },
  '&.cm-focused': { outline: '2px solid rgb(var(--status-info-border))' },
  '.cm-error-line': { backgroundColor: 'rgb(var(--status-danger-bg))' },
})

export function CodeEditor({ value, onChange, language, readOnly = false, minHeight = 160, errorLine = null, ariaLabel }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          language === 'json' ? json() : javascript(),
          syntaxHighlighting(defaultHighlightStyle),
          theme,
          EditorView.theme({ '.cm-content, .cm-gutter': { minHeight: `${minHeight}px` } }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? language, 'data-testid': `code-editor-${language}` }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // Recréé seulement si la langue ou le mode lecture changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Valeur changée de l'extérieur : remplace le document (sans boucle : même texte → rien).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  // Ligne en erreur : classe sur l'élément de ligne (simple, sans décoration d'état).
  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dom.querySelectorAll('.cm-error-line').forEach((el) => el.classList.remove('cm-error-line'))
    if (!errorLine || errorLine > v.state.doc.lines) return
    const pos = v.state.doc.line(errorLine).from
    const { node } = v.domAtPos(pos)
    const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line')
    line?.classList.add('cm-error-line')
  }, [errorLine, value])

  return <div ref={host} />
}
