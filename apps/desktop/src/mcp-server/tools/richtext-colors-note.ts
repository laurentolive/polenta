import { RICHTEXT_HIGHLIGHT_COLORS, RICHTEXT_TEXT_COLORS } from '@polenta/types'

/**
 * GH299 — phrase des descriptions d'outils d'écriture : forme exacte des couleurs d'un richtext.
 * Construite depuis la palette pour ne jamais diverger de `@polenta/types` `richtext-colors`.
 */
export const RICHTEXT_COLORS_NOTE =
  ' Richtext (Markdown) : couleur du texte <span class="pl-c-<couleur>">…</span> ' +
  `(${RICHTEXT_TEXT_COLORS.join(', ')}), surlignage <mark class="pl-hl-<couleur>">…</mark> ` +
  `(${RICHTEXT_HIGHLIGHT_COLORS.join(', ')}) ; balises à l'extérieur du gras/italique ` +
  '(<span …>**x**</span>) ; tout autre HTML reste du texte littéral.'
