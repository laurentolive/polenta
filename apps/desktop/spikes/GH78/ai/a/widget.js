// GH78 — cas a : répartition des statuts d'exigences par composant (barres empilées).
// Une ligne par (composant, statut) ; `_ids` = exigences concernées (drill-down au clic).
export default function (data, polenta) {
  // Index des types d'exigence par (repo, ref) — une même ref peut exister dans deux repos.
  const typeKey = (repo, ref) => repo + '\u0000' + ref
  const types = new Map()
  // Ordre global des statuts (ordre de déclaration, premier type rencontré) et libellés.
  const statusOrder = new Map()
  const statusMeta = new Map()
  for (const t of data.schema.objectTypes) {
    if (t.category !== 'requirement') continue
    types.set(typeKey(t.repo, t.ref), t)
    t.statuses.forEach((s, i) => {
      if (!statusOrder.has(s.name)) statusOrder.set(s.name, statusOrder.size + i / 1000)
      if (!statusMeta.has(s.name)) statusMeta.set(s.name, s)
    })
  }

  const groups = new Map()
  for (const r of data.requirements) {
    const t = types.get(typeKey(r.repo, r.objectTypeRef))
    // Libellé issu du type de l'objet en priorité, sinon d'un autre type, sinon nom technique.
    const def = (t && t.statuses.find((s) => s.name === r.status)) || statusMeta.get(r.status) || null
    const key = r.component + '\u0000' + r.status
    let g = groups.get(key)
    if (!g) {
      g = {
        component: r.component,
        status: r.status,
        statusLabel: def ? def.label : r.status,
        statusOrder: statusOrder.has(r.status) ? statusOrder.get(r.status) : 9999,
        isApproval: def ? def.isApproval : false,
        isTerminal: def ? def.isTerminal : false,
        count: 0,
        _ids: [],
      }
      groups.set(key, g)
    }
    g.count += 1
    g._ids.push(r.id)
  }

  const rows = [...groups.values()]
  for (const g of rows) g._ids.sort()
  rows.sort((a, b) =>
    a.component < b.component ? -1 : a.component > b.component ? 1 : a.statusOrder - b.statusOrder)
  return rows
}
