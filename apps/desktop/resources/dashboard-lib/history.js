// @polenta-lib history 1
// Bibliothèque projet (contenu de départ livré par Polenta, modifiable par le projet).
// Historique des champs suivis (statut et champs `trackHistory`).
import { dayEnd, dayRange } from './time.js'

/**
 * Valeur du champ suivi `field` de `obj` à l'instant `at` (ISO), ou `null` avant la première
 * entrée. Sans historique pour ce champ : la valeur courante.
 * @param {{ status: string, fields: Record<string, unknown>, history: Record<string, { value?: unknown, at: string }[]> }} obj
 * @param {string} field `status` ou nom d'un champ de `fields`
 * @param {string} at
 * @returns {unknown}
 */
export function valueAt(obj, field, at) {
  const h = obj.history && obj.history[field]
  if (!h || h.length === 0) return field === 'status' ? obj.status : (obj.fields ? obj.fields[field] ?? null : null)
  let v = null
  for (const e of h) {
    if (e.at > at) break
    v = e.value === undefined ? null : e.value
  }
  return v
}

/**
 * Courbe empilée d'un champ suivi : une ligne par (jour, valeur) avec le nombre d'objets.
 * Les objets sans valeur à la date (pas encore créés) sont ignorés.
 * `withIds` : ajoute `_ids` (identifiants des objets) ; `drill` (`polenta.drill`) : ne renvoie que la
 * ligne `{ date, value }` demandée, avec ses `_ids`.
 * @param {readonly { id: string, status: string, fields: Record<string, unknown>, history: Record<string, { value?: unknown, at: string }[]> }[]} objects
 * @param {string} field
 * @param {{ from: string, to: string, step?: number, polenta: import('./polenta').PolentaHost, withIds?: boolean }} options `from` / `to` : jours `AAAA-MM-JJ`
 * @returns {import('./polenta').Row[]}
 */
export function timeline(objects, field, { from, to, step = 1, polenta, withIds = false }) {
  const drill = polenta.drill
  const rows = []
  for (const day of dayRange(from, to, step)) {
    if (drill && drill.date !== day) continue
    const at = dayEnd(day, polenta)
    const groups = new Map()
    for (const o of objects) {
      const v = valueAt(o, field, at)
      if (v === null || v === undefined) continue
      const key = String(v)
      if (drill && drill.value !== key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(o.id)
    }
    for (const [value, ids] of groups) {
      const row = { date: day, value, count: ids.length }
      if (withIds || drill) row._ids = ids
      rows.push(row)
    }
  }
  return rows
}
