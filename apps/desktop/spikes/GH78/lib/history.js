// Bibliothèque projet (départ livré par Polenta, modifiable par le projet) — historique GH77.

/** Valeur du champ suivi `field` de `obj` à l'instant `date` (ISO), ou `undefined` avant la
 *  première entrée. Repli : sans historique, la valeur courante. */
export function valueAt(obj, field, date) {
  const h = obj.history && obj.history[field]
  if (!h || h.length === 0) return field === 'status' ? obj.status : obj.fields ? obj.fields[field] : undefined
  let v
  for (const e of h) {
    if (e.at > date) break
    v = e.value
  }
  return v
}

/** Dates de `from` à `to` (inclus) par pas de `step` jours, en ISO (minuit UTC). */
export function dateRange(from, to, step = 1) {
  const out = []
  const end = Date.parse(to)
  for (let t = Date.parse(from.slice(0, 10) + 'T00:00:00Z'); t <= end; t += step * 86400000) out.push(new Date(t).toISOString())
  return out
}

/** Courbe empilée d'un champ suivi : une ligne par (date, valeur) avec le nombre d'objets et
 *  leurs IDs. Les objets sans valeur à la date (pas encore créés) sont ignorés. */
export function timeline(objects, field, { from, to, step = 1, endOfDay = true } = {}) {
  const rows = []
  for (const d of dateRange(from, to, step)) {
    const at = endOfDay ? new Date(Date.parse(d) + 86400000 - 1000).toISOString() : d
    const groups = new Map()
    for (const o of objects) {
      const v = valueAt(o, field, at)
      if (v === undefined) continue
      const key = String(v)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(o.id)
    }
    for (const [value, ids] of groups) rows.push({ date: d.slice(0, 10), value, count: ids.length, _ids: ids })
  }
  return rows
}
