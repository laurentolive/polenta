/**
 * GH56 — disposition de l'ActivityBar choisie par l'utilisateur : ordre des boutons (drag & drop)
 * et boutons masqués (clic droit). Préférence d'interface par poste, commune à tous les projets,
 * en localStorage. Logique pure (pas de DOM) pour être testée par vitest.
 */
import type { Panel } from './AppLayout'

export const ACTIVITY_BAR_LAYOUT_KEY = 'polenta.activityBarLayout'

export interface ActivityBarLayout {
  /** Ordre complet, boutons masqués compris : un bouton réaffiché retrouve sa place. Peut être
   *  partiel (panneau ajouté depuis) ou contenir des ids inconnus (panneau retiré). */
  order: Panel[]
  hidden: Panel[]
}

/** Compte et Projet restent toujours accessibles (préférences, ouverture de projet). */
export const UNHIDEABLE_PANELS: readonly Panel[] = ['account', 'project']

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
}

/** JSON invalide, forme inattendue ou localStorage indisponible → null (disposition par défaut). */
export function loadLayout(): ActivityBarLayout | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACTIVITY_BAR_LAYOUT_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const { order, hidden } = parsed as Record<string, unknown>
    if (!isStringArray(order) || !isStringArray(hidden)) return null
    return { order: order as Panel[], hidden: hidden as Panel[] }
  } catch {
    return null
  }
}

export function saveLayout(layout: ActivityBarLayout): void {
  try { localStorage.setItem(ACTIVITY_BAR_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage unavailable: preference not kept */ }
}

export function clearLayout(): void {
  try { localStorage.removeItem(ACTIVITY_BAR_LAYOUT_KEY) } catch { /* storage unavailable */ }
}

/** Ordonne `defaults` selon `layout.order` : ids inconnus ignorés, panneaux absents ajoutés en fin
 *  dans l'ordre par défaut. */
export function applyOrder(defaults: Panel[], layout: ActivityBarLayout | null): Panel[] {
  if (!layout) return defaults
  const known = new Set(defaults)
  const ordered = [...new Set(layout.order.filter(id => known.has(id)))]
  const placed = new Set(ordered)
  return [...ordered, ...defaults.filter(id => !placed.has(id))]
}

export function hiddenSet(defaults: Panel[], layout: ActivityBarLayout | null): Set<Panel> {
  if (!layout) return new Set()
  const known = new Set(defaults)
  return new Set(layout.hidden.filter(id => known.has(id) && !UNHIDEABLE_PANELS.includes(id)))
}

/** Déplace `id` juste avant/après `targetId` dans l'ordre complet. */
export function movePanel(order: Panel[], id: Panel, targetId: Panel, position: 'before' | 'after'): Panel[] {
  if (id === targetId || !order.includes(id) || !order.includes(targetId)) return order
  const rest = order.filter(p => p !== id)
  const targetIdx = rest.indexOf(targetId)
  rest.splice(position === 'before' ? targetIdx : targetIdx + 1, 0, id)
  return rest
}

export function toggleHidden(hidden: Panel[], id: Panel): Panel[] {
  if (UNHIDEABLE_PANELS.includes(id)) return hidden
  return hidden.includes(id) ? hidden.filter(p => p !== id) : [...hidden, id]
}
