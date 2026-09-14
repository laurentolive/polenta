/**
 * Utilitaires purs de la Vue Recherche — extraits de `SearchPanel.tsx` (T167) pour être
 * partagés entre le panneau latéral, le contexte `SearchProvider` et la liste de résultats
 * de la zone principale (`SearchResultsDoc`). Aucune dépendance React / API.
 */

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

export function replaceInText(text: string, regex: RegExp, replacement: string, preserveCase: boolean): string {
  const freshRe = new RegExp(regex.source, regex.flags)
  return text.replace(freshRe, (match) =>
    preserveCase ? applyPreserveCase(match, replacement) : replacement,
  )
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
  for (const { key, value } of fields) {
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
