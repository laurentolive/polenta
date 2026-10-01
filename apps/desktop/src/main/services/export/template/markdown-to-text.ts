import MarkdownIt from 'markdown-it'

type Token = ReturnType<MarkdownIt['parse']>[number]

// Mêmes options que le rendu à l'écran (`StaticRichTextViewer`) pour que les deux interprètent la
// même source de la même façon (tables GFM et barré activés par défaut dans markdown-it).
let md: MarkdownIt | null = null
function getMd(): MarkdownIt {
  md ??= new MarkdownIt({ html: false, linkify: false })
  return md
}

/**
 * GH34 — texte simple d'un champ richtext (Markdown), pour la balise `{{champ}}` d'un gabarit :
 * syntaxe Markdown retirée, listes préfixées (`•`, `1.`, `☐`/`☒` pour les cases à cocher,
 * indentées selon l'imbrication), cellules de tableau séparées par des tabulations, images et
 * diagrammes draw.io omis (blocs fenced dédiés, cf. SPEC-REQ §3.2a/§3.2b), `[[ID]]` → `ID`.
 * Les blocs sont séparés par un retour à la ligne (rendu en saut de ligne par docxtemplater).
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown.trim()) return ''
  const tokens = getMd().parse(markdown, {})
  const lines: string[] = []
  // Pile des listes ouvertes : compteur courant pour une liste ordonnée, null pour des puces.
  const lists: (number | null)[] = []
  let prefix = ''
  let row: string[] | null = null
  let cell: string | null = null

  for (const token of tokens) {
    switch (token.type) {
      case 'bullet_list_open':
        lists.push(null)
        break
      case 'ordered_list_open':
        lists.push(Number(token.attrGet('start') ?? 1))
        break
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop()
        break
      case 'list_item_open': {
        const depth = lists.length - 1
        const counter = lists[depth]
        let marker = '•'
        if (counter !== null && counter !== undefined) {
          marker = `${counter}.`
          lists[depth] = counter + 1
        }
        prefix = `${'  '.repeat(Math.max(0, depth))}${marker} `
        break
      }
      case 'tr_open':
        row = []
        break
      case 'tr_close':
        if (row) lines.push(row.join('\t'))
        row = null
        break
      case 'th_open':
      case 'td_open':
        cell = ''
        break
      case 'th_close':
      case 'td_close':
        row?.push(cell ?? '')
        cell = null
        break
      case 'inline': {
        let text = inlineText(token)
        if (cell !== null) {
          cell += text
          break
        }
        if (prefix) {
          // Case à cocher GFM (`- [ ] …`) : marqueur remplacé par la case elle-même.
          const task = /^\[( |x|X)\]\s+/.exec(text)
          if (task) {
            text = text.slice(task[0].length)
            prefix = prefix.replace(/(•|\d+\.) $/, task[1] === ' ' ? '☐ ' : '☒ ')
          }
          lines.push(prefix + text)
          prefix = ''
        } else {
          lines.push(text)
        }
        break
      }
      case 'fence':
      case 'code_block': {
        const info = token.info.trim()
        if (info === 'image' || info === 'drawio') break
        lines.push(...token.content.replace(/\n$/, '').split('\n'))
        break
      }
      default:
        break
    }
  }
  return lines.join('\n')
}

function inlineText(token: Token): string {
  let out = ''
  for (const child of token.children ?? []) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content
    else if (child.type === 'softbreak' || child.type === 'hardbreak') out += '\n'
    else if (child.type === 'image') out += ''
  }
  // Liens internes `[[SW-0042]]` → `SW-0042` (pas de lien hypertexte en export, GH34 §2.5).
  return out.replace(/\[\[([^\]]+)\]\]/g, '$1')
}
