import { Mark, mergeAttributes } from '@tiptap/core'
import type MarkdownIt from 'markdown-it'
import {
  highlightClass, isRichTextHighlightColor, isRichTextTextColor, textColorClass,
  type RichTextHighlightColor, type RichTextTextColor,
} from '@polenta/types'
import { markdownRichTextColors } from '../../shared/richTextColors'

/**
 * GH299 — marques TipTap « couleur du texte » (`<span class="pl-c-…">`) et « surlignage »
 * (`<mark class="pl-hl-…">`). Format, palette et liste blanche : `@polenta/types` `richtext-colors`.
 *
 * - `parseHTML` n'accepte qu'une classe exacte de la palette : un collage Word / web
 *   (`style="color:…"`) ne crée aucune marque, un collage interne (HTML de `renderHTML`) la garde.
 * - Sérialisation Markdown propre (`tiptap-markdown` en `html: false` ignorerait la marque) ;
 *   relecture par le plugin markdown-it partagé, branché via `parse.setup`.
 * - Ordre d'imbrication à l'écriture = rang du schéma (priorité, puis ordre des extensions) :
 *   `MARK_PRIORITY` > celle de StarterKit (100) place les balises **à l'extérieur** du gras,
 *   de l'italique, du barré et du code. Indispensable : en CommonMark, `**<span …>x</span>**y`
 *   n'est pas du gras (le `**` fermant, entre `>` et une lettre, n'est pas « right-flanking ») —
 *   `<span …>**x**</span>y` l'est. Déclarer `HighlightColor` avant `TextColor` : `<mark>` extérieur.
 * - Une couleur par marque (exclusion par défaut) : en choisir une remplace la précédente.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: RichTextTextColor) => ReturnType
      unsetTextColor: () => ReturnType
    }
    highlightColor: {
      setHighlightColor: (color: RichTextHighlightColor) => ReturnType
      unsetHighlightColor: () => ReturnType
    }
  }
}

/** Au-dessus des marques de StarterKit (100), sous `Link` (1000). */
const MARK_PRIORITY = 101

const setupMarkdown = { setup: (md: MarkdownIt) => markdownRichTextColors(md) }

function classColor(el: HTMLElement, prefix: string): string | null {
  const cls = el.getAttribute('class') ?? ''
  return cls.startsWith(prefix) ? cls.slice(prefix.length) : null
}

export const HighlightColor = Mark.create({
  name: 'highlightColor',
  priority: MARK_PRIORITY,

  addAttributes() {
    return { color: { default: null, parseHTML: el => classColor(el, 'pl-hl-'), renderHTML: () => ({}) } }
  },

  parseHTML() {
    return [{
      tag: 'mark',
      getAttrs: el => (isRichTextHighlightColor(classColor(el as HTMLElement, 'pl-hl-')) ? null : false),
    }]
  },

  renderHTML({ mark, HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: highlightClass(mark.attrs.color) }), 0]
  },

  addCommands() {
    return {
      setHighlightColor: color => ({ commands }) => commands.setMark(this.name, { color }),
      unsetHighlightColor: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color: RichTextHighlightColor } }) => `<mark class="${highlightClass(mark.attrs.color)}">`,
          close: '</mark>',
        },
        parse: setupMarkdown,
      },
    }
  },
})

export const TextColor = Mark.create({
  name: 'textColor',
  priority: MARK_PRIORITY,

  addAttributes() {
    return { color: { default: null, parseHTML: el => classColor(el, 'pl-c-'), renderHTML: () => ({}) } }
  },

  parseHTML() {
    return [{
      tag: 'span',
      getAttrs: el => (isRichTextTextColor(classColor(el as HTMLElement, 'pl-c-')) ? null : false),
    }]
  },

  renderHTML({ mark, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: textColorClass(mark.attrs.color) }), 0]
  },

  addCommands() {
    return {
      setTextColor: color => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color: RichTextTextColor } }) => `<span class="${textColorClass(mark.attrs.color)}">`,
          close: '</span>',
        },
        parse: setupMarkdown,
      },
    }
  },
})
