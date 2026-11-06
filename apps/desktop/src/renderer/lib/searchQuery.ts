/**
 * Utilitaires purs de la Vue Recherche — extraits de `SearchPanel.tsx` (T167) pour être
 * partagés entre le panneau latéral, le contexte `SearchProvider` et la liste de résultats
 * de la zone principale (`SearchResultsDoc`). Aucune dépendance React / API.
 */
import { richTextColorTagRegExp, splitRichTextColorTags, stripRichTextColorTags } from '@polenta/types'

export interface SearchOpts {
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
  preserveCase: boolean
}

export interface SearchTypes {
  requirements: boolean
  tests: boolean
  campaigns: boolean
}

export type ItemType = 'requirement' | 'test' | 'campaign'

export interface MatchedField {
  key: string
  excerpt: string
  matchStart: number
  matchLength: number
}

export interface SearchResult {
  itemType: ItemType
  id: string
  title: string
  matches: MatchedField[]
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildRegex(query: string, opts: SearchOpts): RegExp | null {
  if (!query.trim()) return null
  try {
    let pattern = opts.isRegex ? query : escapeRegex(query)
    if (opts.wholeWord) pattern = `\\b${pattern}\\b`
    return new RegExp(pattern, 'g' + (opts.caseSensitive ? '' : 'i'))
  } catch {
    return null
  }
}

export function applyPreserveCase(original: string, replacement: string): string {
  if (!replacement) return replacement
  if (original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1)
  }
  return replacement.toLowerCase()
}

/**
 * GH299 — remplace les occurrences trouvées dans le texte **visible** (balises de couleur d'un
 * richtext retirées, comme `findMatches`) : `^`, `$`, `\b` voient le texte affiché, et une
 * occurrence à cheval sur une balise (`6<span …>0</span>`) est remplacée. Les positions sont
 * reportées dans la source ; les balises comprises dans une occurrence sont conservées, après le
 * texte de remplacement — une balise n'est jamais modifiée ni perdue.
 */
export function replaceInText(text: string, regex: RegExp, replacement: string, preserveCase: boolean): string {
  const replaceWith = (match: string) => (preserveCase ? applyPreserveCase(match, replacement) : replacement)
  const parts = splitRichTextColorTags(text)
  if (!parts.some(p => p.tag)) return text.replace(new RegExp(regex.source, regex.flags), replaceWith)
  // Sans `g` : première occurrence seulement, comme `String.replace`.
  const global = regex.flags.includes('g')
  const flags = global ? regex.flags : `${regex.flags}g`

  // Texte visible et, pour chacun de ses caractères, sa position dans la source.
  let visible = ''
  const rawIndex: number[] = []
  let pos = 0
  for (const p of parts) {
    if (!p.tag) {
      visible += p.text
      for (let k = 0; k < p.text.length; k++) rawIndex.push(pos + k)
    }
    pos += p.text.length
  }

  let out = ''
  let rawPos = 0
  for (const m of visible.matchAll(new RegExp(regex.source, flags))) {
    if (!m[0]) continue
    const start = rawIndex[m.index]
    const end = rawIndex[m.index + m[0].length - 1] + 1
    const keptTags = text.slice(start, end).match(richTextColorTagRegExp('g'))?.join('') ?? ''
    out += text.slice(rawPos, start) + replaceWith(m[0]) + keptTags
    rawPos = end
    if (!global) break
  }
  return out + text.slice(rawPos)
}

export function getStringFields(fields: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(fields).flatMap(([key, val]) => {
    if (typeof val === 'string' && val.trim()) return [{ key, value: val }]
    if (Array.isArray(val)) {
      const joined = val.filter((v): v is string => typeof v === 'string').join(' ')
      if (joined) return [{ key, value: joined }]
    }
    return []
  })
}

export function findMatches(
  fields: Array<{ key: string; value: string }>,
  regex: RegExp,
): MatchedField[] {
  const matched: MatchedField[] = []
  for (const { key, value: raw } of fields) {
    // GH299 — correspondance et extrait sur le texte visible (balises de couleur retirées).
    const value = stripRichTextColorTags(raw)
    regex.lastIndex = 0
    const m = regex.exec(value)
    if (m) {
      const CTX = 35
      const from = Math.max(0, m.index - CTX)
      const to = Math.min(value.length, m.index + m[0].length + CTX)
      const prefix = from > 0 ? '…' : ''
      const suffix = to < value.length ? '…' : ''
      matched.push({
        key,
        excerpt: prefix + value.slice(from, to) + suffix,
        matchStart: m.index - from + prefix.length,
        matchLength: m[0].length,
      })
    }
  }
  return matched
}
