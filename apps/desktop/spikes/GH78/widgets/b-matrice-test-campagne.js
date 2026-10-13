// (b) Matrice test × campagne (équivalent GH69) : une cellule par (test, campagne) avec le
// dernier statut de l'entrée (si plusieurs instances du test : la plus défavorable).
const SEVERITY = { FAIL: 5, BLOCKED: 4, INCOMPLETE: 3, pending: 2, PASS: 1 }

export default function (data, polenta) {
  const titles = new Map(data.tests.map(t => [t.id, t.title]))
  const rows = []
  for (const c of data.campaigns) {
    const cells = new Map()
    for (const e of c.entries) {
      const prev = cells.get(e.testCaseId)
      if (!prev || SEVERITY[e.status] > SEVERITY[prev.status]) cells.set(e.testCaseId, { status: e.status, entries: (prev ? prev.entries : 0) + 1 })
      else prev.entries++
    }
    for (const [testId, cell] of cells) {
      rows.push({
        test: testId + ' ' + (titles.get(testId) || ''),
        testId,
        campaign: c.id,
        campaignTitle: c.title,
        status: cell.status,
        entries: cell.entries,
        _ids: [testId, c.id],
      })
    }
  }
  return rows
}
