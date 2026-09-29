import type { CampaignTestRun, ParamResolutionPreview, ReqInstancePreview, ReqInstanceSelection } from '@polenta/types'

// T179 — tests « itérants » (contenant `{req.<champ>}`, avec au moins une exigence liée) : une
// instance de campagne par exigence retenue. Ces helpers portent l'état du panneau d'ajout et du
// formulaire de création : exigences cochées et valeurs saisies à la main par instance.

/** Par test itérant : exigence cochée → valeurs saisies. Test absent : sélection par défaut
 *  (toutes les exigences encore sans instance, cochées). */
export type ReqSelectionState = Record<string, Record<string, Record<string, string>>>

export function isIteratingPreview(p: ParamResolutionPreview | undefined): boolean {
  return !!p?.requirements?.length
}

/** Exigences du test ayant déjà une instance dans la campagne. */
export function presentReqIds(runs: CampaignTestRun[], testId: string): Set<string> {
  return new Set(runs.filter(r => r.testCaseId === testId && r.requirementId).map(r => r.requirementId!))
}

/** Exigences liées sans instance dans la campagne (seules proposables à l'ajout). */
export function missingReqs(p: ParamResolutionPreview | undefined, present: Set<string>): ReqInstancePreview[] {
  return (p?.requirements ?? []).filter(r => !present.has(r.requirementId))
}

/** Sélection effective d'un test itérant : l'état explicite s'il existe, sinon toutes les exigences
 *  sans instance, cochées, sans valeur saisie. Une exigence devenue indisponible est ignorée. */
export function effectiveReqSelection(
  testId: string,
  p: ParamResolutionPreview | undefined,
  present: Set<string>,
  state: ReqSelectionState,
): Record<string, Record<string, string>> {
  const available = missingReqs(p, present)
  const explicit = state[testId]
  if (!explicit) return Object.fromEntries(available.map(r => [r.requirementId, {}]))
  return Object.fromEntries(available.filter(r => explicit[r.requirementId]).map(r => [r.requirementId, explicit[r.requirementId]]))
}

/** Coche / décoche une exigence (l'état explicite part de la sélection effective). */
export function toggleReq(
  state: ReqSelectionState,
  testId: string,
  requirementId: string,
  current: Record<string, Record<string, string>>,
): ReqSelectionState {
  const next = { ...current }
  if (next[requirementId]) delete next[requirementId]
  else next[requirementId] = {}
  return { ...state, [testId]: next }
}

export function setReqValue(
  state: ReqSelectionState,
  testId: string,
  requirementId: string,
  current: Record<string, Record<string, string>>,
  key: string,
  value: string,
): ReqSelectionState {
  return { ...state, [testId]: { ...current, [requirementId]: { ...(current[requirementId] ?? {}), [key]: value } } }
}

/**
 * Complétude de l'ajout : pour un test itérant, chaque exigence cochée a toutes ses références à
 * saisir remplies (aucune cochée : le test est ignoré) ; pour les autres, règle T97/T171. Avec
 * `requireInstance` (panneau d'ajout), faux si rien ne serait ajouté.
 */
export function isAddComplete(
  selectedIds: Iterable<string>,
  previews: Map<string, ParamResolutionPreview>,
  paramValues: Record<string, Record<string, string>>,
  reqState: ReqSelectionState,
  presentOf: (testId: string) => Set<string>,
  requireInstance = true,
): boolean {
  let instances = 0
  const filled = (keys: string[], values: Record<string, string> | undefined) =>
    keys.every(k => !!values?.[k]?.trim())
  for (const id of selectedIds) {
    const p = previews.get(id)
    const manual = p?.manual ?? []
    if (isIteratingPreview(p)) {
      const sel = effectiveReqSelection(id, p, presentOf(id), reqState)
      for (const values of Object.values(sel)) {
        if (!filled(manual, values)) return false
        instances++
      }
    } else {
      if (!filled(manual, paramValues[id])) return false
      instances++
    }
  }
  return !requireInstance || instances > 0
}

/** Sélection envoyée au main pour les tests itérants (`addTests` / `create`). */
export function buildReqInstances(
  selectedIds: Iterable<string>,
  previews: Map<string, ParamResolutionPreview>,
  reqState: ReqSelectionState,
  presentOf: (testId: string) => Set<string>,
): ReqInstanceSelection {
  const out: ReqInstanceSelection = {}
  for (const id of selectedIds) {
    const p = previews.get(id)
    if (!isIteratingPreview(p)) continue
    const sel = effectiveReqSelection(id, p, presentOf(id), reqState)
    out[id] = Object.entries(sel).map(([requirementId, paramValues]) => ({ requirementId, paramValues }))
  }
  return out
}

/** Nombre d'instances qu'ajouterait la sélection (libellé du bouton). */
export function countInstances(
  selectedIds: Iterable<string>,
  previews: Map<string, ParamResolutionPreview>,
  reqState: ReqSelectionState,
  presentOf: (testId: string) => Set<string>,
): number {
  let n = 0
  for (const id of selectedIds) {
    const p = previews.get(id)
    n += isIteratingPreview(p) ? Object.keys(effectiveReqSelection(id, p, presentOf(id), reqState)).length : 1
  }
  return n
}
