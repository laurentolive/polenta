import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { parseParamRefs } from '@polenta/types'
import type { ParamRefApi } from '../contexts/ParamRefContext'
import { paramRefTitle } from '../lib/markdownParamRefs'

export const paramRefPluginKey = new PluginKey<DecorationSet>('paramRefs')

export interface ParamRefDecorationOptions {
  getApi: () => ParamRefApi | null
  getUnresolvedLabel: () => string
  /** Lecture seule : la référence résolue est remplacée à l'affichage par sa valeur. */
  getReadOnly: () => boolean
}

/** Valeur affichée à la place de la source masquée, en lecture seule. */
function valueWidget(api: ParamRefApi, key: string, display: string, title: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'param-ref'
  el.textContent = display
  el.title = title
  el.dataset.paramRef = key
  el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); api.openParameter(key) })
  return el
}

function buildDecorations(doc: PMNode, api: ParamRefApi | null, unresolvedLabel: string, readOnly: boolean): DecorationSet {
  if (!api) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isText || !node.text || node.marks.some(m => m.type.name === 'code')) return
    for (const ref of parseParamRefs(node.text)) {
      const from = pos + ref.index
      const resolved = api.resolve(ref.key)
      // T179 — `{req.<champ>}` hors champ de test : texte brut, sans décoration.
      if (resolved.status === 'literal') continue
      if (resolved.status === 'req') {
        decos.push(Decoration.inline(from, from + ref.raw.length, {
          class: 'param-ref param-ref--req',
          title: resolved.title,
          'data-param-ref': ref.key,
        }, { key: ref.key }))
        continue
      }
      if (readOnly && resolved.status === 'ok') {
        const to = from + ref.raw.length
        decos.push(Decoration.inline(from, to, { class: 'param-ref-source' }, { key: ref.key }))
        decos.push(Decoration.widget(to, () => valueWidget(api, ref.key, resolved.display, paramRefTitle(api, ref.key, unresolvedLabel)),
          { key: `${ref.key}@${resolved.display}`, side: -1 }))
        continue
      }
      decos.push(Decoration.inline(from, from + ref.raw.length, {
        class: resolved.status === 'ok' ? 'param-ref' : 'param-ref param-ref--unresolved',
        // En édition, la référence reste affichée telle qu'écrite ; la valeur est au survol.
        title: resolved.status === 'ok'
          ? `${resolved.display} — ${paramRefTitle(api, ref.key, unresolvedLabel)}`
          : paramRefTitle(api, ref.key, unresolvedLabel),
        'data-param-ref': ref.key,
      }, { key: ref.key }))
    }
  })
  return DecorationSet.create(doc, decos)
}

function isInCode(view: EditorView, pos: number): boolean {
  const $pos = view.state.doc.resolve(pos)
  if ($pos.parent.type.name === 'codeBlock') return true
  return $pos.marks().some(m => m.type.name === 'code')
}

/** Ouvre le sélecteur au caret ; le choix remplace le `{` tapé en `from` par `{clé}`. */
export function openPickerAt(view: EditorView, api: ParamRefApi, from: number, replaceBrace: boolean): void {
  const coords = view.coordsAtPos(from)
  api.openPicker(new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top), key => {
    const { state } = view
    const text = `{${key}}`
    const tr = replaceBrace && state.doc.textBetween(from, from + 1) === '{'
      ? state.tr.insertText(text, from, from + 1)
      : state.tr.insertText(text)
    view.dispatch(tr)
    view.focus()
  })
}

/**
 * T171 — références de paramètres dans l'éditeur Tiptap : décorations (pas de nœud dédié —
 * le Markdown stocké reste `{nom}`), survol = valeur et nom, double-clic = édition du
 * paramètre, saisie de `{` = sélecteur d'insertion. Les options lisent le `ParamRefProvider`
 * via des getters (l'extension est créée une fois) ; un changement des bases se propage par
 * une transaction portant la meta `paramRefPluginKey`.
 */
export const ParamRefDecoration = Extension.create<ParamRefDecorationOptions>({
  name: 'paramRefDecoration',

  addOptions() {
    return { getApi: () => null, getUnresolvedLabel: () => '', getReadOnly: () => false }
  },

  addProseMirrorPlugins() {
    const { getApi, getUnresolvedLabel, getReadOnly } = this.options
    const build = (doc: PMNode) => buildDecorations(doc, getApi(), getUnresolvedLabel(), getReadOnly())
    return [
      new Plugin<DecorationSet>({
        key: paramRefPluginKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(paramRefPluginKey) ? build(newState.doc) : old.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: state => paramRefPluginKey.getState(state),
          handleDoubleClick: (view, pos) => {
            const api = getApi()
            if (!api) return false
            const hit = paramRefPluginKey.getState(view.state)?.find(pos, pos)[0]
            const key = (hit?.spec as { key?: string } | undefined)?.key
            if (!key) return false
            api.openParameter(key)
            return true
          },
          handleTextInput: (view, from, _to, text) => {
            const api = getApi()
            if (text !== '{' || !api || !view.editable || isInCode(view, from)) return false
            // Laisse le `{` s'insérer, puis ouvre le sélecteur ancré dessus.
            setTimeout(() => openPickerAt(view, api, from, true), 0)
            return false
          },
        },
      }),
    ]
  },
})
