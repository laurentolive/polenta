// Bibliothèque projet — état d'une campagne dans le temps (faits GH73 : addedAt, removedAt,
// runs rattachés par campaignEntry ; repli §6.2 pour les données antérieures).
import { dateRange } from './history.js'

export const ENTRY_STATUSES = ['pending', 'PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE']

/** Index des runs par entrée de campagne : `${campaignId}\u0000${entryId}` → runs triés. */
export function runsByEntry(runs) {
  const m = new Map()
  for (const r of runs) {
    if (!r.campaignEntry) continue
    const k = r.campaignEntry.campaignId + '\u0000' + r.campaignEntry.entryId
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  for (const list of m.values()) list.sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1))
  return m
}

/** Statut d'une entrée à `date` : résultat du dernier run ≤ date, `pending` sinon ;
 *  `null` si l'entrée n'est pas dans la campagne à cette date. */
export function entryStatusAt(campaign, entry, entryRuns, date) {
  const added = entry.addedAt || campaign.createdAt
  if (added > date) return null
  if (entry.removedAt && entry.removedAt <= date) return null
  let s = 'pending'
  for (const r of entryRuns) {
    if (r.executedAt > date) break
    s = r.result
  }
  return s
}

/** Une ligne par (date, statut) : nombre d'entrées et IDs des tests concernés (drill-down).
 *  Balayage : chaque entrée parcourt une fois les dates et ses runs (O(dates + runs) par entrée).
 *  `ids: false` : `_ids` vides (courbes longues : les IDs se demandent au clic). */
export function campaignTimeline(campaign, runs, { from, to, step = 1, ids = true } = {}) {
  return campaignsTimeline([campaign], runs, { from: from || campaign.createdAt, to: to || campaign.completedAt || new Date().toISOString(), step, ids })
}

/** Même courbe, cumulée sur plusieurs campagnes, en un seul balayage (une campagne close garde
 *  son état final jusqu'à `to`). */
export function campaignsTimeline(campaigns, runs, { from, to, step = 1, ids = true } = {}) {
  const index = runs instanceof Map ? runs : runsByEntry(runs)
  const start = from || campaigns.reduce((m, c) => (c.createdAt < m ? c.createdAt : m), to)
  const days = dateRange(start, to, step)
  const ends = days.map(d => new Date(Date.parse(d) + 86400000 - 1000).toISOString())
  const counts = days.map(() => ({ pending: 0, PASS: 0, FAIL: 0, BLOCKED: 0, INCOMPLETE: 0 }))
  const lists = ids ? days.map(() => ({ pending: [], PASS: [], FAIL: [], BLOCKED: [], INCOMPLETE: [] })) : null
  for (const campaign of campaigns) {
    for (const e of campaign.entries.concat(campaign.removedEntries || [])) {
      const er = index.get(campaign.id + '\u0000' + e.entryId) || []
      const added = e.addedAt || campaign.createdAt
      let k = 0
      let s = 'pending'
      for (let i = 0; i < days.length; i++) {
        const at = ends[i]
        if (added > at) continue
        if (e.removedAt && e.removedAt <= at) break
        while (k < er.length && er[k].executedAt <= at) s = er[k++].result
        counts[i][s]++
        if (lists) lists[i][s].push(e.testCaseId)
      }
    }
  }
  const rows = []
  for (let i = 0; i < days.length; i++) {
    for (const status of ENTRY_STATUSES) rows.push({ date: days[i].slice(0, 10), status, count: counts[i][status], _ids: lists ? lists[i][status] : [] })
  }
  return rows
}
