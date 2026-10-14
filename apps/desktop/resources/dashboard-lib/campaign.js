// @polenta-lib campaign 1
// Bibliothèque projet (contenu de départ livré par Polenta, modifiable par le projet).
// Campagnes : état dans le temps, étape d'avancement d'une entrée, dernier résultat d'un test.
import { dayEnd, dayOf, dayRange } from './time.js'
import { ENTRY_ORDER, entryStatusLabel, isApproval, statusLabel, typeIndex } from './status.js'

const sep = '/'

/**
 * Exécutions de chaque entrée de campagne, triées par date, clé `<campagne>/<entrée>`.
 *
 * - Run portant `campaignEntry` (depuis GH73) : rattaché à son entrée.
 * - Données antérieures (repli GH73 §6.2, approximatif) : le run `entry.runId` est rattaché à son
 *   entrée ; un autre run sans `campaignEntry` l'est s'il porte sur le même test et la même exigence,
 *   entre la création de la campagne et la date du run `entry.runId`, et qu'une seule entrée est
 *   candidate (sinon il n'est rattaché à aucune). L'entrée est alors marquée `approximate`.
 * @param {import('./polenta').PolentaGraph} data
 * @returns {Map<string, { runs: { at: string, result: string }[], approximate: boolean }>}
 */
export function entryRuns(data) {
  const out = new Map()
  const get = (k) => {
    let v = out.get(k)
    if (!v) { v = { runs: [], approximate: false }; out.set(k, v) }
    return v
  }
  const byId = new Map()
  for (const r of data.runs) {
    byId.set(r.id, r)
    if (r.campaignEntry) get(r.campaignEntry.campaignId + sep + r.campaignEntry.entryId).runs.push({ at: r.executedAt, result: r.result })
  }
  // Repli : entrées dont le dernier run n'est pas rattaché (antérieur à GH73).
  const used = new Set()
  const candidates = new Map()
  for (const c of data.campaigns) {
    for (const e of c.entries.concat(c.removedEntries)) {
      const last = e.runId ? byId.get(e.runId) : undefined
      if (!last || last.campaignEntry) continue
      const k = c.id + sep + e.entryId
      get(k).runs.push({ at: last.executedAt, result: last.result })
      used.add(last.id)
      const ck = e.testCaseId + '\u0000' + (e.requirementId ?? '')
      if (!candidates.has(ck)) candidates.set(ck, [])
      candidates.get(ck).push({ key: k, from: c.createdAt, to: last.executedAt })
    }
  }
  for (const r of data.runs) {
    if (r.campaignEntry || used.has(r.id)) continue
    const list = candidates.get(r.testCaseId + '\u0000' + (r.requirementId ?? ''))
    if (!list) continue
    const match = list.filter((c) => c.from <= r.executedAt && r.executedAt <= c.to)
    if (match.length !== 1) continue
    const v = get(match[0].key)
    v.runs.push({ at: r.executedAt, result: r.result })
    v.approximate = true
  }
  for (const v of out.values()) v.runs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return out
}

/**
 * État de campagnes jour par jour : une ligne par (jour, statut d'entrée) avec le nombre d'entrées,
 * cumulé sur les campagnes choisies (une campagne close garde son état final). Un seul balayage
 * par entrée (jours + runs).
 *
 * Colonnes : `date` (jour local), `status`, `label`, `order`, `count`, `approximate` (vrai si une
 * entrée comptée repose sur le repli des données antérieures à GH73), `_ids` (`<campagne>/<entrée>`,
 * avec `withIds`, ou pour la seule ligne demandée par `polenta.drill`).
 * @param {import('./polenta').PolentaGraph} data
 * @param {{ polenta: import('./polenta').PolentaHost, campaignIds?: readonly string[], from?: string, to?: string, step?: number, withIds?: boolean, runs?: ReturnType<typeof entryRuns> }} options `from` / `to` : jours `AAAA-MM-JJ` (défaut : création de la plus ancienne campagne → aujourd'hui)
 * @returns {import('./polenta').Row[]}
 */
export function campaignsTimeline(data, { polenta, campaignIds, from, to, step = 1, withIds = false, runs }) {
  const campaigns = campaignIds ? data.campaigns.filter((c) => campaignIds.includes(c.id)) : data.campaigns
  if (campaigns.length === 0) return []
  const index = runs ?? entryRuns(data)
  const start = from ?? campaigns.reduce((m, c) => { const d = dayOf(c.createdAt, polenta); return d < m ? d : m }, polenta.today)
  const end = to ?? polenta.today
  const drill = polenta.drill
  let days = dayRange(start, end, step)
  if (drill) days = days.filter((d) => d === drill.date)
  const ends = days.map((d) => dayEnd(d, polenta))
  const counts = days.map(() => ({ pending: 0, INCOMPLETE: 0, BLOCKED: 0, FAIL: 0, PASS: 0 }))
  const approx = days.map(() => false)
  const ids = withIds || drill ? days.map(() => ({ pending: [], INCOMPLETE: [], BLOCKED: [], FAIL: [], PASS: [] })) : null
  for (const c of campaigns) {
    for (const e of c.entries.concat(c.removedEntries)) {
      const er = index.get(c.id + sep + e.entryId)
      const list = er ? er.runs : []
      const approximate = !e.addedAt || (er ? er.approximate : false)
      const added = e.addedAt || c.createdAt
      const removed = 'removedAt' in e ? e.removedAt : null
      let k = 0
      let s = 'pending'
      for (let i = 0; i < days.length; i++) {
        const at = ends[i]
        if (added > at) continue
        if (removed && removed <= at) break
        while (k < list.length && list[k].at <= at) s = list[k++].result
        counts[i][s]++
        if (approximate) approx[i] = true
        if (ids) ids[i][s].push(c.id + sep + e.entryId)
      }
    }
  }
  const rows = []
  for (let i = 0; i < days.length; i++) {
    ENTRY_ORDER.forEach((status, order) => {
      if (drill && drill.status !== status) return
      const row = { date: days[i], status, label: entryStatusLabel(data, status), order, count: counts[i][status], approximate: approx[i] }
      if (ids) row._ids = ids[i][status]
      rows.push(row)
    })
  }
  return rows
}

/**
 * Même chose pour une seule campagne.
 * @param {import('./polenta').PolentaGraph} data
 * @param {string} campaignId
 * @param {{ polenta: import('./polenta').PolentaHost, from?: string, to?: string, step?: number, withIds?: boolean }} options
 * @returns {import('./polenta').Row[]}
 */
export function campaignTimeline(data, campaignId, options) {
  return campaignsTimeline(data, { ...options, campaignIds: [campaignId] })
}

// ─── Étape d'avancement d'une entrée (ex-règle GH71) ─────────────────────────

export const STEP_READY = 'ready'
const PREP = 'prep:'
const RESULTS = ['INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS']

/**
 * Index réutilisable pour `entryStep` / `stepRank` / `stepLabel` sur un même graphe.
 * @param {import('./polenta').PolentaGraph} data
 */
export function stepContext(data) {
  const tests = new Map(data.tests.map((t) => [t.id, t]))
  const type = typeIndex(data)
  /** Statut de préparation → plus petite position parmi les types de test, et premier libellé. */
  const prepOrder = new Map()
  const prepLabel = new Map()
  for (const t of data.schema.objectTypes) {
    if (t.category !== 'test') continue
    t.statuses.forEach((s, i) => {
      const known = prepOrder.get(s.name)
      if (known === undefined || i < known) prepOrder.set(s.name, i)
      if (!prepLabel.has(s.name)) prepLabel.set(s.name, s.label)
    })
  }
  return { tests, type, prepOrder, prepLabel }
}

/**
 * Étape d'avancement d'une entrée, de la définition du test au résultat :
 * `prep:<statut du test>` tant que le test n'est pas approuvé, `ready` s'il l'est, puis le résultat.
 * Test considéré : le test vivant si l'entrée est resynchronisable (`resyncable`), sinon la copie
 * figée, à défaut le test vivant.
 * @param {import('./polenta').PolentaGraph} data
 * @param {import('./polenta').GraphEntry} entry
 * @param {ReturnType<typeof stepContext>} [ctx]
 * @returns {string}
 */
export function entryStep(data, entry, ctx = stepContext(data)) {
  if (entry.status !== 'pending') return entry.status
  const live = ctx.tests.get(entry.testCaseId)
  const subject = entry.resyncable ? (live ?? entry.snapshot) : (entry.snapshot ?? live)
  if (!subject) return STEP_READY
  const type = live ? ctx.type(live.repo, live.objectTypeRef) : null
  return isApproval(type, subject.status) ? STEP_READY : PREP + subject.status
}

/**
 * Rang canonique d'une étape (pour trier) : préparation selon la position du statut dans les types
 * de test, statut inconnu ensuite, puis `ready`, puis les résultats `INCOMPLETE`, `BLOCKED`, `FAIL`,
 * `PASS`.
 * @param {string} step
 * @param {ReturnType<typeof stepContext>} ctx
 * @returns {number}
 */
export function stepRank(step, ctx) {
  if (step.startsWith(PREP)) return ctx.prepOrder.get(step.slice(PREP.length)) ?? 999
  if (step === STEP_READY) return 1000
  const r = RESULTS.indexOf(step)
  return r === -1 ? 2000 : 1001 + r
}

/**
 * Libellé d'une étape.
 * @param {import('./polenta').PolentaGraph} data
 * @param {string} step
 * @param {ReturnType<typeof stepContext>} ctx
 * @param {'fr' | 'en'} [locale]
 * @returns {string}
 */
export function stepLabel(data, step, ctx, locale = 'fr') {
  if (step.startsWith(PREP)) return ctx.prepLabel.get(step.slice(PREP.length)) ?? step.slice(PREP.length)
  if (step === STEP_READY) return locale === 'en' ? 'Ready to run' : 'Prêt à exécuter'
  return entryStatusLabel(data, step)
}

// ─── Dernier résultat ────────────────────────────────────────────────────────

/**
 * Dernier résultat de chaque test (toutes exécutions, campagne ou non), clé = ID du test.
 * @param {import('./polenta').PolentaGraph} data
 * @returns {Map<string, { result: string, executedAt: string, runId: string, campaignEntry: { campaignId: string, entryId: string } | null }>}
 */
export function lastResults(data) {
  const out = new Map()
  for (const r of data.runs) {
    const known = out.get(r.testCaseId)
    if (!known || r.executedAt > known.executedAt) {
      out.set(r.testCaseId, { result: r.result, executedAt: r.executedAt, runId: r.id, campaignEntry: r.campaignEntry })
    }
  }
  return out
}

/**
 * Dernier résultat d'un test, ou `null` s'il n'a jamais été exécuté.
 * @param {import('./polenta').PolentaGraph} data
 * @param {string} testId
 */
export function lastResult(data, testId) {
  return lastResults(data).get(testId) ?? null
}

/** Libellé d'un statut de test (copie ou test vivant) — réexporté pour les scripts. */
export { statusLabel }
