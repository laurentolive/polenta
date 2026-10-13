import { STATUS_HISTORY_KEY } from '@polenta/types'
import type { HistoryEntry, ObjectHistory, ObjectTypeDefinition } from '@polenta/types'

// GH77 — mise en forme de l'historique pour la section « Historique » (spec §10) : données brutes,
// libellés retrouvés dans le schéma, aucune synthèse. Logique pure (testée sans DOM).

export type HistoryBadge = 'mcp' | 'git' | 'schema' | 'implicit'

export interface HistoryRow {
  /** Valeur affichée ; `null` = champ vidé ; `undefined` = événement seul (contenu modifié). */
  value: string | null | undefined
  at: string
  by?: string
  badges: HistoryBadge[]
}

export interface HistorySectionData {
  key: string
  label: string
  rows: HistoryRow[]
}

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function row(entry: HistoryEntry, label: (v: string) => string): HistoryRow {
  const badges: HistoryBadge[] = []
  if (entry.source) badges.push(entry.source)
  if (entry.implicit) badges.push('implicit')
  const value = !('value' in entry) ? undefined : entry.value === null ? null : label(valueText(entry.value))
  return { value, at: String(entry.at), ...(entry.by && { by: entry.by }), badges }
}

/**
 * Sections dans l'ordre : statut, champs dans l'ordre du schéma, puis clés inconnues du schéma (champ
 * retiré ou renommé à la main), nom brut. Entrées les plus récentes d'abord. Un statut ou une valeur
 * retirés du schéma s'affichent tels quels.
 */
export function historySections(
  history: ObjectHistory,
  typeDef: Pick<ObjectTypeDefinition, 'fields' | 'statuses'> | null | undefined,
  labels: { status: string; statusLabel?: (name: string) => string },
): HistorySectionData[] {
  const fieldOrder = (typeDef?.fields ?? []).map(f => f.name)
  const keys = Object.keys(history).filter(k => (history[k] ?? []).length > 0)
  const rank = (k: string) => k === STATUS_HISTORY_KEY ? -1 : fieldOrder.includes(k) ? fieldOrder.indexOf(k) : fieldOrder.length
  const ordered = [...keys].sort((a, b) => rank(a) - rank(b))

  return ordered.map(key => {
    const isStatus = key === STATUS_HISTORY_KEY
    const statusLabel = (name: string) =>
      labels.statusLabel?.(name) ?? typeDef?.statuses?.find(s => s.name === name)?.label ?? name
    const label = isStatus ? labels.status : typeDef?.fields.find(f => f.name === key)?.label || key
    // Inversée avant le tri (stable) : à date égale, l'entrée ajoutée en dernier passe devant.
    const rows = [...history[key]].reverse()
      .sort((a, b) => (String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0))
      .map(e => row(e, isStatus ? statusLabel : v => v))
    return { key, label, rows }
  })
}
