import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { findElementRefs } from '../lib/elementRefs'

export const elementRefPluginKey = new PluginKey<DecorationSet>('elementRefs')

export interface ElementRefDecorationOptions {
  /** ID d'un élément existant du workspace (`null` : index absent, pas de décoration). */
  getExists: () => ((id: string) => boolean) | null
}

function buildDecorations(doc: PMNode, exists: ((id: string) => boolean) | null): DecorationSet {
  if (!exists) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isText || !node.text || node.marks.some(m => m.type.name === 'code' || m.type.name === 'link')) return
    for (const ref of findElementRefs(node.text, exists)) {
      const from = pos + ref.index
      decos.push(Decoration.inline(from, from + ref.id.length, { class: 'element-ref', 'data-element-ref': ref.id }))
    }
  })
  return DecorationSet.create(doc, decos)
}

/**
 * GH229 §2.2 — ID d'élément du texte dans un éditeur Tiptap en lecture seule (`RichTextViewer`) :
 * décorations seulement (le Markdown n'est pas modifié). Les gestes (clic, survol) sont délégués
 * au conteneur (`useElementRefDelegation`). Un changement de l'index se propage par une
 * transaction portant la meta `elementRefPluginKey`.
 */
export const ElementRefDecoration = Extension.create<ElementRefDecorationOptions>({
  name: 'elementRefDecoration',

  addOptions() {
    return { getExists: () => null }
  },

  addProseMirrorPlugins() {
    const { getExists } = this.options
    const build = (doc: PMNode) => buildDecorations(doc, getExists())
    return [
      new Plugin<DecorationSet>({
        key: elementRefPluginKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged || tr.getMeta(elementRefPluginKey) ? build(newState.doc) : old.map(tr.mapping, tr.doc),
        },
        props: { decorations: state => elementRefPluginKey.getState(state) },
      }),
    ]
  },
})
