// @polenta-lib time 1
// Bibliothèque projet (contenu de départ livré par Polenta, modifiable par le projet).
// Découpage par jour dans le fuseau de l'utilisateur. Le moteur n'a pas `Intl` et l'heure locale
// de `Date` est celle du serveur : on lit les décalages fournis par `polenta.timezoneOffsets`.

const DAY_MS = 86400000

/**
 * Décalage (minutes) du fuseau de l'utilisateur à un instant.
 * @param {string | number} instant ISO 8601 ou millisecondes
 * @param {import('./polenta').PolentaHost} polenta
 * @returns {number}
 */
export function offsetAt(instant, polenta) {
  const t = typeof instant === 'number' ? instant : Date.parse(instant)
  const table = polenta.timezoneOffsets
  let lo = 0
  let hi = table.length - 1
  if (hi < 0 || t < Date.parse(table[0].from)) return table.length ? table[0].offsetMinutes : 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (Date.parse(table[mid].from) <= t) lo = mid
    else hi = mid - 1
  }
  return table[lo].offsetMinutes
}

/**
 * Jour local `AAAA-MM-JJ` d'un instant.
 * @param {string | number} instant
 * @param {import('./polenta').PolentaHost} polenta
 * @returns {string}
 */
export function dayOf(instant, polenta) {
  const t = typeof instant === 'number' ? instant : Date.parse(instant)
  return new Date(t + offsetAt(t, polenta) * 60000).toISOString().slice(0, 10)
}

/**
 * Dernier instant (ISO, à la seconde) du jour local `day`.
 * @param {string} day `AAAA-MM-JJ`
 * @param {import('./polenta').PolentaHost} polenta
 * @returns {string}
 */
export function dayEnd(day, polenta) {
  const localEnd = Date.parse(day + 'T00:00:00Z') + DAY_MS - 1000
  // Décalage lu à la fin du jour local (approché par l'instant UTC correspondant).
  const offset = offsetAt(localEnd - offsetAt(localEnd, polenta) * 60000, polenta)
  return new Date(localEnd - offset * 60000).toISOString().replace('.000Z', 'Z')
}

/**
 * Jours locaux de `from` à `to` inclus, par pas de `step` jours.
 * @param {string} from `AAAA-MM-JJ`
 * @param {string} to `AAAA-MM-JJ`
 * @param {number} [step]
 * @returns {string[]}
 */
export function dayRange(from, to, step = 1) {
  const out = []
  const end = Date.parse(to + 'T00:00:00Z')
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= end; t += step * DAY_MS) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
