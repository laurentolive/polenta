import type MarkdownIt from 'markdown-it'
import { highlightClass, richTextColorTagRegExp, textColorClass, type RichTextHighlightColor, type RichTextTextColor } from '@polenta/types'

/**
 * GH299 — plugin markdown-it des balises de couleur d'un richtext (`<span class="pl-c-…">`,
 * `<mark class="pl-hl-…">`, cf. `@polenta/types` `richtext-colors`). Branché sur les trois parseurs
 * de l'application — éditeur (`tiptap-markdown`, via `RichTextColorMarks`), `StaticRichTextViewer`,
 * exports du main (`parseMarkdown`) — qui gardent `html: false` : seules ces formes exactes,
 * **appariées** dans un même bloc inline, produisent du HTML ; tout le reste reste littéral.
 *
 * - règle inline au `<` (avant `html_inline`) : jamais active dans un code inline ni un bloc de
 *   code ; un `&lt;span…` (texte littéral tapé en mode riche, échappé par `tiptap-markdown`) est
 *   une entité, pas un `<`, et reste du texte ;
 * - règle core après `inline` (avant `text_join`) : appariement par pile, imbrication stricte ;
 *   une balise orpheline ou qui en chevauche une autre redevient du texte ;
 * - rendu : classe reconstruite depuis la palette, jamais recopiée du source.
 */

export type RichTextColorTag = 'span' | 'mark'

export interface RichTextColorOpenMeta {
  tag: RichTextColorTag
  /** `span` : couleur de texte ; `mark` : couleur de surlignage. */
  color: RichTextTextColor | RichTextHighlightColor
}

const equipped = new WeakSet<MarkdownIt>()

export function markdownRichTextColors(md: MarkdownIt): void {
  // `tiptap-markdown` rappelle `setup` à chaque parse sur la même instance.
  if (equipped.has(md)) return
  equipped.add(md)

  const sticky = richTextColorTagRegExp('y')

  md.inline.ruler.before('html_inline', 'pl_color', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false
    sticky.lastIndex = state.pos
    const m = sticky.exec(state.src)
    if (!m) return false
    if (!silent) {
      const token = m[3]
        ? state.push('pl_color_close', m[3], 0)
        : state.push('pl_color_open', m[1] ? 'span' : 'mark', 0)
      token.markup = m[0]
      token.meta = m[3]
        ? { tag: m[3] as RichTextColorTag }
        : { tag: m[1] ? 'span' : 'mark', color: (m[1] ?? m[2]) as RichTextColorOpenMeta['color'] } satisfies RichTextColorOpenMeta
    }
    state.pos += m[0].length
    return true
  })

  md.core.ruler.after('inline', 'pl_color_pair', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const children = block.children
      if (!children.some(t => t.type === 'pl_color_open' || t.type === 'pl_color_close')) continue
      const open: number[] = []
      const matched = new Set<number>()
      children.forEach((tok, i) => {
        if (tok.type === 'pl_color_open') open.push(i)
        else if (tok.type === 'pl_color_close') {
          // Imbrication stricte : la fermante ne s'apparie qu'à la dernière ouvrante, de même
          // balise. Des balises qui se chevauchent (`<span>a<mark>b</span>c</mark>`) restent en
          // partie littérales plutôt que de produire un HTML mal imbriqué, que le navigateur
          // réparerait autrement que l'éditeur et l'export Word.
          const top = open.at(-1)
          if (top !== undefined && (children[top].meta as RichTextColorOpenMeta).tag === tok.meta.tag) {
            matched.add(top).add(i)
            open.pop()
          }
        }
      })
      for (const [i, tok] of children.entries()) {
        if ((tok.type === 'pl_color_open' || tok.type === 'pl_color_close') && !matched.has(i)) {
          const text = new state.Token('text', '', 0)
          text.content = tok.markup
          children[i] = text
        }
      }
    }
  })

  md.renderer.rules.pl_color_open = (tokens, idx) => {
    const meta = tokens[idx].meta as RichTextColorOpenMeta
    return meta.tag === 'span'
      ? `<span class="${textColorClass(meta.color as RichTextTextColor)}">`
      : `<mark class="${highlightClass(meta.color as RichTextHighlightColor)}">`
  }
  md.renderer.rules.pl_color_close = (tokens, idx) => `</${(tokens[idx].meta as { tag: RichTextColorTag }).tag}>`
}
