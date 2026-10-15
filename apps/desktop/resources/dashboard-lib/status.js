// @polenta-lib status 1
// Bibliothèque projet (contenu de départ livré par Polenta, modifiable par le projet).
// Statuts : types d'objet, libellés, gravité des statuts d'entrée de campagne.

/** Ordre d'affichage des statuts d'entrée de campagne. */
export const ENTRY_ORDER = ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS']

/** Gravité : le statut le plus grave l'emporte (« pire statut »). */
export const ENTRY_SEVERITY = { FAIL: 4, BLOCKED: 3, INCOMPLETE: 2, pending: 1, PASS: 0 }

/**
 * Pire statut d'une liste de statuts d'entrée (`null` si vide).
 * @param {readonly string[]} statuses
 * @returns {string | null}
 */
export function worst(statuses) {
  let out = null
  for (const s of statuses) {
    if (out === null || (ENTRY_SEVERITY[s] ?? -1) > (ENTRY_SEVERITY[out] ?? -1)) out = s
  }
  return out
}

/**
 * Index des types d'objet par (repo, objectTypeRef).
 * @param {import('./polenta').PolentaGraph} data
 * @returns {(repo: string, ref: string) => import('./polenta').GraphObjectType | null}
 */
export function typeIndex(data) {
  const m = new Map()
  for (const t of data.schema.objectTypes) m.set(t.repo + '\u0000' + t.ref, t)
  return (repo, ref) => m.get(repo + '\u0000' + ref) ?? null
}

/**
 * Vrai si `status` est le statut d'approbation du type (à défaut de statut déclaré : `approved`).
 * @param {import('./polenta').GraphObjectType | null} type
 * @param {string} status
 * @returns {boolean}
 */
export function isApproval(type, status) {
  const approval = type ? type.statuses.find((s) => s.isApproval) : undefined
  return status === (approval ? approval.name : 'approved')
}

/**
 * Libellé d'un statut d'objet dans son type (à défaut : le nom).
 * @param {import('./polenta').GraphObjectType | null} type
 * @param {string} status
 * @returns {string}
 */
export function statusLabel(type, status) {
  const s = type ? type.statuses.find((x) => x.name === status) : undefined
  return s ? s.label : status
}

/**
 * Libellé d'un statut d'entrée de campagne.
 * @param {import('./polenta').PolentaGraph} data
 * @param {string} status
 * @returns {string}
 */
export function entryStatusLabel(data, status) {
  const s = data.schema.entryStatuses.find((x) => x.name === status)
  return s ? s.label : status
}
