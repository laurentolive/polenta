import type { SchemaField } from './schema'
import { stripRichTextColorTags } from './richtext-colors'

// GH206 — validateurs de champ (`SchemaField.validator`), partagés par le main (import en masse, fusion,
// mise à jour MCP, contraintes de transition) et le renderer. Déplacés de `field-checks.util.ts`.

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
  // GH299 — balises de couleur retirées : `<span class="pl-c-red">WHEN</span>` commence par WHEN.
  let text = stripRichTextColorTags(v).trimStart()
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

/**
 * GH206 — valeur d'un champ refusée par son `validator` : `EARS`, ou `regex:<motif>` (testé sur la valeur
 * en chaîne). Champ vide, sans validateur ou validateur inconnu : null (rien à contrôler). Motif invalide :
 * null aussi, le schéma reste utilisable.
 */
export function validatorError(field: Pick<SchemaField, 'name' | 'label' | 'validator'>, value: unknown): string | null {
  const validator = field.validator?.trim()
  if (!validator || !isFilled(value)) return null
  const label = field.label ?? field.name
  if (validator.toUpperCase() === 'EARS') {
    return isEarsCompliant(value) ? null : `« ${label} » ne respecte pas la syntaxe EARS`
  }
  if (validator.startsWith('regex:')) {
    let re: RegExp
    try { re = new RegExp(validator.slice('regex:'.length)) } catch { return null }
    const text = Array.isArray(value) ? value.map(String).join('\n') : String(value)
    return re.test(text) ? null : `« ${label} » ne respecte pas le format attendu`
  }
  return null
}
