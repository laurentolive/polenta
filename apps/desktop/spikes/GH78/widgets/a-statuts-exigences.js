// (a) Répartition des statuts d'exigences, par composant.
export default function (data, polenta) {
  const labels = new Map()
  for (const t of data.schema.objectTypes) for (const s of t.statuses) labels.set(t.repo + '|' + t.ref + '|' + s.name, s.label)
  const groups = new Map()
  for (const r of data.requirements) {
    const key = r.component + '\u0000' + r.status
    if (!groups.has(key)) groups.set(key, { component: r.component, status: r.status, label: labels.get(r.repo + '|' + r.objectTypeRef + '|' + r.status) || r.status, count: 0, _ids: [] })
    const g = groups.get(key)
    g.count++
    g._ids.push(r.id)
  }
  return [...groups.values()]
}
