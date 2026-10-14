// @polenta-lib maturity 1
// Bibliothèque projet (contenu de départ livré par Polenta, modifiable par le projet).
// Maturité d'une exigence : les critères de CLAUDE.md « Règles de cohérence », appliqués au schéma
// du projet (aucun nom de champ codé en dur). Repris de l'ancien calcul de Polenta (T77).
import { isApproval, typeIndex } from './status.js'

const EARS = /^\s*(WHEN|WHILE|WHERE|IF|THE)\b[\s\S]*\bSHALL\b/i

const LABELS = {
  fr: { type: "type d'objet invalide", required: 'champs requis', ears: 'EARS', acceptance: "critère d'acceptance", verification: 'lien de vérification', revalidation: 'impact à vérifier' },
  en: { type: 'invalid object type', required: 'required fields', ears: 'EARS', acceptance: 'acceptance criterion', verification: 'verification link', revalidation: 'impact to check' },
}

/**
 * Valeur renseignée : chaîne non blanche, tableau non vide, toute autre valeur présente.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isFilled(v) {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/**
 * Énoncé au format EARS (heuristique : mot-clé EARS en tête, puis SHALL), marques Markdown de début
 * de ligne ignorées.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isEarsCompliant(raw) {
  if (typeof raw !== 'string') return false
  let text = raw.trimStart()
  let prev
  do {
    prev = text
    text = text.replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
  } while (text !== prev)
  text = text.replace(/[*_`]/g, '').trim()
  return text.length > 0 && EARS.test(text)
}

function isMeasurable(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return false
  return /-\s*\[[ xX]?\]/.test(text) || /\d/.test(text)
}

/**
 * Index réutilisable sur un même graphe.
 * @param {import('./polenta').PolentaGraph} data
 */
export function maturityContext(data) {
  return { type: typeIndex(data) }
}

/**
 * Maturité d'une exigence. Un critère impossible à vérifier (type introuvable, aucun champ
 * concerné) est considéré comme rempli ; une exigence sans `objectTypeRef` ne l'est pas.
 * @param {import('./polenta').PolentaGraph} data
 * @param {import('./polenta').GraphRequirement} req
 * @param {ReturnType<typeof maturityContext>} [ctx]
 * @param {'fr' | 'en'} [locale]
 * @returns {{ ok: boolean, requiredFieldsOk: boolean, earsOk: boolean, acceptanceOk: boolean, verificationOk: boolean, noRevalidation: boolean, missing: string[] }}
 */
export function maturity(data, req, ctx = maturityContext(data), locale = 'fr') {
  const hasType = typeof req.objectTypeRef === 'string' && req.objectTypeRef.length > 0
  const type = hasType ? ctx.type(req.repo, req.objectTypeRef) : null
  const fields = type ? type.fields : []
  const values = req.fields || {}

  const requiredOk = fields.filter((f) => f.required).every((f) => isFilled(values[f.name]))
  const earsOk = fields.filter((f) => f.validator === 'EARS').every((f) => isEarsCompliant(values[f.name]))
  const acceptField = fields.find((f) => /accept/i.test(f.name) || (f.label != null && /accept/i.test(f.label)))
  const acceptanceOk = !acceptField || isMeasurable(values[acceptField.name])
  const verificationOk = !isApproval(type, req.status) || req.coverageStatus !== 'not_covered'
  const noRevalidation = !req.needsRevalidation

  const L = LABELS[locale] || LABELS.fr
  const missing = []
  if (!hasType) missing.push(L.type)
  if (!requiredOk) missing.push(L.required)
  if (!earsOk) missing.push(L.ears)
  if (!acceptanceOk) missing.push(L.acceptance)
  if (!verificationOk) missing.push(L.verification)
  if (!noRevalidation) missing.push(L.revalidation)
  return {
    ok: missing.length === 0,
    requiredFieldsOk: hasType && requiredOk,
    earsOk,
    acceptanceOk,
    verificationOk,
    noRevalidation,
    missing,
  }
}
