import type { RichTextHighlightColor, RichTextTextColor } from '@polenta/types'

/**
 * GH299 — teintes de la palette richtext (noms : `@polenta/types` `richtext-colors`), triplets RGB
 * « R G B » comme les tokens de `renderer/theme.config.ts`. **Source unique** : le thème en dérive
 * les tokens `rt-c-<nom>` / `rt-hl-<nom>` (variables CSS), l'export Word en lit la valeur claire.
 *
 * Texte : contraste ≥ 4.5:1 sur la surface (blanc en clair, slate-800 en sombre).
 * Surlignage : fond pâle en clair sous l'encre sombre, fond profond en sombre sous l'encre claire.
 * Fichier sans dépendance d'exécution : importé par `scripts/generate-theme-css.ts` (tsx).
 */
export interface RichTextColorValue { light: string; dark: string }

export const RICHTEXT_TEXT_COLOR_VALUES: Record<RichTextTextColor, RichTextColorValue> = {
  red: { light: '220 38 38', dark: '248 113 113' },
  orange: { light: '194 65 12', dark: '251 146 60' },
  green: { light: '21 128 61', dark: '74 222 128' },
  blue: { light: '29 78 216', dark: '96 165 250' },
  purple: { light: '126 34 206', dark: '192 132 252' },
  gray: { light: '100 116 139', dark: '148 163 184' },
}

export const RICHTEXT_HIGHLIGHT_COLOR_VALUES: Record<RichTextHighlightColor, RichTextColorValue> = {
  yellow: { light: '254 240 138', dark: '113 63 18' },
  green: { light: '187 247 208', dark: '20 83 45' },
  blue: { light: '191 219 254', dark: '30 58 138' },
  pink: { light: '251 207 232', dark: '131 24 67' },
  orange: { light: '254 215 170', dark: '124 45 18' },
}

/** Triplet « R G B » → hex sans `#` (`DC2626`), pour l'OOXML. */
export function rgbTripletToHex(triplet: string): string {
  return triplet.split(/\s+/).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
}
