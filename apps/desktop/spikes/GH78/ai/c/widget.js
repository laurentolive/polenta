// GH78 — cas c : avancement d'une campagne dans le temps (aires empilées par statut).
// Pour chaque jour UTC [création de la campagne .. clôture ou polenta.now], nombre d'entrées
// dans chaque statut à la fin du jour. Statut reconstruit depuis les exécutions (runs)
// rattachées à l'entrée, l'ajout (addedAt) et le retrait (removedAt) de l'entrée.

const STATUSES = ['pending', 'PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE']
const RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'])

function day(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null
}

function nextDay(d) {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

/** Fin de la campagne : completedAt, sinon date du passage en statut final (historique), sinon now. */
function campaignEnd(c, now) {
  if (c.completedAt) return c.completedAt
  if (c.status === 'completed' || c.status === 'abandoned') {
    const h = (c.history && c.history.status) || []
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i] && h[i].value === c.status && h[i].at) return h[i].at
    }
  }
  return now
}

/** Événements de statut d'une entrée : [{at, status}] triés par date. */
function entryEvents(c, e, runsById, runsByEntry) {
  const events = []
  const added = e.addedAt || c.createdAt
  events.push({ at: added, status: 'pending' })

  const seen = new Set()
  const linked = runsByEntry.get(e.entryId) || []
  for (const r of linked) {
    seen.add(r.id)
    if (RESULTS.has(r.result)) events.push({ at: r.executedAt, status: r.result })
  }
  // Run référencé par l'entrée mais pas rattaché (données antérieures à GH73).
  if (e.runId && !seen.has(e.runId) && runsById.has(e.runId)) {
    const r = runsById.get(e.runId)
    if (RESULTS.has(r.result)) events.push({ at: r.executedAt, status: r.result })
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  // Verdict courant sans run correspondant (saisie directe) : on l'ajoute à executedAt.
  const last = events[events.length - 1]
  if (e.status !== 'pending' && RESULTS.has(e.status) && last.status !== e.status) {
    const at = e.executedAt || (last.at > added ? last.at : added)
    events.push({ at, status: e.status })
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  }
  return events
}

export default function (data, polenta) {
  const campaignId = polenta && polenta.params ? polenta.params.campaignId : null
  const c = (data.campaigns || []).find((x) => x.id === campaignId)
  if (!c || !c.createdAt) return []

  const runsById = new Map()
  const runsByEntry = new Map()
  for (const r of data.runs || []) {
    runsById.set(r.id, r)
    if (r.campaignEntry && r.campaignEntry.campaignId === c.id) {
      const k = r.campaignEntry.entryId
      if (!runsByEntry.has(k)) runsByEntry.set(k, [])
      runsByEntry.get(k).push(r)
    }
  }

  const entries = []
  for (const e of c.entries || []) entries.push({ e, removedAt: null })
  for (const e of c.removedEntries || []) entries.push({ e, removedAt: e.removedAt || null })

  const timelines = entries.map(({ e, removedAt }) => ({
    entry: e,
    removedDay: day(removedAt),
    addedDay: day(e.addedAt || c.createdAt),
    events: entryEvents(c, e, runsById, runsByEntry).map((ev) => ({ d: day(ev.at), status: ev.status })),
  }))

  const startDay = day(c.createdAt)
  let endDay = day(campaignEnd(c, polenta.now)) || startDay
  if (endDay < startDay) endDay = startDay

  const order = {}
  STATUSES.forEach((s, i) => (order[s] = i))

  const rows = []
  let guard = 0
  for (let d = startDay; d <= endDay && guard < 3700; d = nextDay(d), guard++) {
    const buckets = {}
    for (const s of STATUSES) buckets[s] = { count: 0, ids: new Set(), entries: [] }

    for (const t of timelines) {
      if (t.addedDay && t.addedDay > d) continue // pas encore ajoutée
      if (t.removedDay && t.removedDay <= d) continue // retirée avant la fin du jour
      let status = 'pending'
      for (const ev of t.events) {
        if (ev.d && ev.d <= d) status = ev.status
        else break
      }
      const b = buckets[status] || buckets.pending
      b.count++
      b.ids.add(t.entry.testCaseId)
      b.entries.push(t.entry.entryId)
    }

    for (const s of STATUSES) {
      const b = buckets[s]
      rows.push({
        date: d,
        status: s,
        statusOrder: order[s],
        count: b.count,
        entries: b.entries.join(', '),
        campaignId: c.id,
        _ids: Array.from(b.ids),
      })
    }
  }
  return rows
}
