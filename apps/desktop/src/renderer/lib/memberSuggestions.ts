import type { ForgeMemberSuggestion } from '@polenta/types'

/** GH368 — nombre maximum de suggestions affichées (spec §1.4). */
export const MEMBER_SUGGESTIONS_LIMIT = 8

/** Minuscules, sans accents. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * GH368 — suggestions pour le texte saisi (spec §1.4) : le texte est cherché dans le login ou le
 * nom affiché, sans casse ni accents ; membres de l'organisation propriétaire d'abord, puis logins
 * qui commencent par le texte, puis ordre alphabétique. Texte vide : aucune suggestion.
 */
export function rankMemberSuggestions(
  all: ForgeMemberSuggestion[],
  query: string,
  opts: { ownerOrg?: string; exclude: string[]; limit?: number },
): ForgeMemberSuggestion[] {
  const q = fold(query.trim())
  if (!q) return []
  const excluded = new Set(opts.exclude.map(e => e.toLowerCase()))
  const owner = opts.ownerOrg?.toLowerCase()
  return all
    .filter(s => !excluded.has(s.login.toLowerCase()) && (fold(s.login).includes(q) || fold(s.name).includes(q)))
    .map(s => ({
      s,
      inOwner: owner !== undefined && s.orgs.some(o => o.toLowerCase() === owner) ? 0 : 1,
      prefix: fold(s.login).startsWith(q) ? 0 : 1,
    }))
    .sort((a, b) => a.inOwner - b.inOwner || a.prefix - b.prefix || a.s.login.localeCompare(b.s.login))
    .slice(0, opts.limit ?? MEMBER_SUGGESTIONS_LIMIT)
    .map(r => r.s)
}
