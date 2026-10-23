/**
 * Contrôles de champs utilisés par les fonctions de Polenta : import en masse (MCP, T122) et
 * résolution de conflits (GH37). GH74 — la maturité des exigences (anciennes colonnes `maturity*`
 * du moteur SQL) n'est plus calculée par Polenta : c'est un script de la bibliothèque projet
 * (`dashboards/lib/maturity.js`), qui reprend ces deux règles à l'identique.
 */

/** Valeur renseignée : chaîne non blanche, tableau non vide, toute autre valeur présente. */
export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true // number/boolean/object present at all counts as "filled"
}

/**
 * Les champs richtext sont stockés en **Markdown** (TipTap `Markdown`, `html: false`) : on retire
 * juste assez de syntaxe de début de ligne (titre, citation, puces, gras / italique) pour que
 * l'ancrage « commence par un mot-clé EARS » trouve le mot-clé. Pas un parseur Markdown complet.
 */
function stripMarkdownForEars(v: unknown): string {
  if (typeof v !== 'string') return ''
  let text = v.trimStart()
  let prev: string
  do {
    prev = text
    text = text.replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
  } while (text !== prev)
  return text.replace(/[*_`]/g, '').trim()
}

/**
 * Heuristique EARS (CLAUDE.md) : le texte commence par un des 5 mots-clés (`WHEN`, `WHILE`,
 * `WHERE`, `IF`, `THE`) et contient `SHALL` ensuite. Volontairement tolérante : contrôle de
 * structure, pas de validation sémantique.
 */
const EARS_PATTERN = /^\s*(WHEN|WHILE|WHERE|IF|THE)\b[\s\S]*\bSHALL\b/i

export function isEarsCompliant(raw: unknown): boolean {
  const text = stripMarkdownForEars(raw)
  return text.length > 0 && EARS_PATTERN.test(text)
}
