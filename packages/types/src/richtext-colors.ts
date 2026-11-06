/**
 * GH299 — couleur du texte et surlignage dans un champ `richtext`.
 *
 * Le richtext est du Markdown (sans syntaxe couleur) : une couleur s'écrit en HTML inline restreint,
 * avec une **classe nommée** de la palette — jamais un code couleur, la teinte réelle vient du thème :
 *
 *   <span class="pl-c-red">…</span>      couleur du texte
 *   <mark class="pl-hl-yellow">…</mark>  surlignage
 *
 * Seules ces formes exactes sont reconnues (balise, attribut `class` seul entre guillemets doubles,
 * nom de la palette) ; tout autre HTML reste du texte littéral. Les noms sont écrits dans les
 * fichiers des projets : ne jamais en renommer ni en retirer un.
 */

export const RICHTEXT_TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'gray'] as const
export const RICHTEXT_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const

export type RichTextTextColor = typeof RICHTEXT_TEXT_COLORS[number]
export type RichTextHighlightColor = typeof RICHTEXT_HIGHLIGHT_COLORS[number]

export const textColorClass = (color: RichTextTextColor): string => `pl-c-${color}`
export const highlightClass = (color: RichTextHighlightColor): string => `pl-hl-${color}`

export function isRichTextTextColor(value: unknown): value is RichTextTextColor {
  return typeof value === 'string' && (RICHTEXT_TEXT_COLORS as readonly string[]).includes(value)
}

export function isRichTextHighlightColor(value: unknown): value is RichTextHighlightColor {
  return typeof value === 'string' && (RICHTEXT_HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

const TAG_SOURCE =
  `<span class="pl-c-(${RICHTEXT_TEXT_COLORS.join('|')})">` +
  `|<mark class="pl-hl-(${RICHTEXT_HIGHLIGHT_COLORS.join('|')})">` +
  `|</(span|mark)>`

/**
 * Balise de couleur ouvrante ou fermante reconnue. Groupes : 1 = couleur de texte (ouvrante
 * `span`), 2 = couleur de surlignage (ouvrante `mark`), 3 = balise fermante (`span` | `mark`).
 * `flags` : `y` pour un test à une position (plugin markdown-it), `g` pour un parcours.
 */
export function richTextColorTagRegExp(flags = ''): RegExp {
  return new RegExp(TAG_SOURCE, flags)
}

/** Texte « visible » d'un richtext : balises de couleur reconnues retirées, contenu conservé. */
export function stripRichTextColorTags(text: string): string {
  if (!text.includes('<')) return text
  return text.replace(richTextColorTagRegExp('g'), '')
}

/**
 * Découpe une valeur en segments texte / balise de couleur (concaténés, ils redonnent la source) :
 * permet de transformer le texte (remplacement de la Vue Recherche) sans jamais toucher une balise.
 */
export function splitRichTextColorTags(text: string): { text: string; tag: boolean }[] {
  if (!text.includes('<')) return [{ text, tag: false }]
  const out: { text: string; tag: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(richTextColorTagRegExp('g'))) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ text: text.slice(last, idx), tag: false })
    out.push({ text: m[0], tag: true })
    last = idx + m[0].length
  }
  if (last < text.length || out.length === 0) out.push({ text: text.slice(last), tag: false })
  return out
}
