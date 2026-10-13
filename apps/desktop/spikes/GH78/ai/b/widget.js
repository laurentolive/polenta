// Matrice test × campagne — une ligne de sortie par couple (test, campagne) ayant au moins
// une entrée active. Statut retenu = le plus défavorable des entrées du test dans la campagne.
// Paramètres optionnels : params.campaignIds (string[]), params.includeAbandoned (bool, défaut true).

// Rang de gravité : plus grand = plus défavorable.
const SEVERITY = { PASS: 0, pending: 1, INCOMPLETE: 2, BLOCKED: 3, FAIL: 4 }

export default function (data, polenta) {
  const params = (polenta && polenta.params) || {}
  const onlyCampaigns = Array.isArray(params.campaignIds) ? new Set(params.campaignIds) : null
  const includeAbandoned = params.includeAbandoned !== false

  const testsById = new Map()
  for (const t of data.tests) testsById.set(t.id, t)

  // Colonnes dans l'ordre chronologique de création de la campagne.
  const campaigns = data.campaigns
    .filter((c) => (!onlyCampaigns || onlyCampaigns.has(c.id)) && (includeAbandoned || c.status !== 'abandoned'))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))

  const rows = []
  campaigns.forEach((c, campaignOrder) => {
    const byTest = new Map()
    for (const e of c.entries) {
      let cell = byTest.get(e.testCaseId)
      if (!cell) {
        cell = { status: e.status, count: 0, entryIds: [], lastExecutedAt: null, snapshotTitle: null }
        byTest.set(e.testCaseId, cell)
      }
      cell.count += 1
      cell.entryIds.push(e.entryId)
      if (SEVERITY[e.status] > SEVERITY[cell.status]) cell.status = e.status
      if (e.executedAt && (!cell.lastExecutedAt || e.executedAt > cell.lastExecutedAt)) cell.lastExecutedAt = e.executedAt
      if (!cell.snapshotTitle && e.snapshot) cell.snapshotTitle = e.snapshot.title
    }
    for (const [testId, cell] of byTest) {
      const test = testsById.get(testId)
      const testTitle = test ? test.title : cell.snapshotTitle || ''
      rows.push({
        _ids: [testId, c.id],
        testId,
        testTitle,
        testLabel: testTitle ? `${testId} — ${testTitle}` : testId,
        testRepo: test ? test.repo : null,
        campaignId: c.id,
        campaignTitle: c.title,
        campaignLabel: c.title ? `${c.id} — ${c.title}` : c.id,
        campaignStatus: c.status,
        campaignOrder,
        status: cell.status,
        severity: SEVERITY[cell.status],
        entryCount: cell.count,
        entryIds: cell.entryIds.join(', '),
        lastExecutedAt: cell.lastExecutedAt,
      })
    }
  })

  rows.sort((a, b) => (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : a.campaignOrder - b.campaignOrder))
  return rows
}
