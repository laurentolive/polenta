/**
 * GH342 — placement des fenêtres de l'application : décalage d'une nouvelle fenêtre, remise à
 * l'écran d'une fenêtre restaurée, lecture tolérante de `windows-state.json`. Pur (pas
 * d'Electron) : testé unitairement.
 */

import { isValidAppRoute, routeProjectId } from '../../shared/app-route'

export { isValidAppRoute }

export interface Rect { x: number; y: number; width: number; height: number }

export interface WindowPlacement extends Rect {
  maximized?: boolean
  fullScreen?: boolean
}

export interface SavedWindow extends WindowPlacement {
  /** Page de l'onglet actif à la fermeture (`pathname?search`). */
  route?: string
}

export interface DisplayArea { workArea: Rect }

/** Fenêtres rouvertes au plus (fichier forgé ou corrompu : pas de rafale de fenêtres). */
export const MAX_SAVED_WINDOWS = 8
export const NEW_WINDOW_OFFSET = 30
const MIN_WIDTH = 400
const MIN_HEIGHT = 300

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Ramène `r` dans `area` : taille réduite si besoin, puis position décalée vers l'intérieur. */
function clampInto(area: Rect, r: Rect): Rect {
  const width = Math.min(r.width, area.width)
  const height = Math.min(r.height, area.height)
  const x = Math.min(Math.max(r.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(r.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

function centerIn(area: Rect, width: number, height: number): Rect {
  const w = Math.min(width, area.width)
  const h = Math.min(height, area.height)
  return {
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    width: w,
    height: h,
  }
}

/**
 * Nouvelle fenêtre ouverte depuis `from` : même taille, décalée de +30/+30, gardée dans l'aire de
 * travail de l'écran qui contient le plus la fenêtre d'origine.
 */
export function offsetPlacement(from: Rect, displays: DisplayArea[]): Rect {
  const target = { ...from, x: from.x + NEW_WINDOW_OFFSET, y: from.y + NEW_WINDOW_OFFSET }
  const area = displays
    .map(d => d.workArea)
    .reduce<Rect | null>((best, a) => (!best || overlap(a, from) > overlap(best, from) ? a : best), null)
  return area ? clampInto(area, target) : target
}

/**
 * Placement restauré : gardé sur l'écran actuel qui recouvre au moins la moitié de la fenêtre,
 * ramené entièrement dans son aire de travail (une fenêtre collée au bord, ou débordant de ses
 * bordures invisibles sous Windows, reste sur son écran) ; sinon (écran débranché, résolution
 * changée) recentré sur l'écran principal, réduit à son aire de travail si besoin. Maximisation et
 * plein écran conservés.
 */
export function fitToDisplays(p: WindowPlacement, displays: DisplayArea[], primary: DisplayArea): WindowPlacement {
  const { maximized, fullScreen } = p
  const rect: Rect = { x: p.x, y: p.y, width: p.width, height: p.height }
  const flags = { ...(maximized ? { maximized } : {}), ...(fullScreen ? { fullScreen } : {}) }
  const best = displays
    .map(d => d.workArea)
    .reduce<Rect | null>((acc, a) => (!acc || overlap(a, rect) > overlap(acc, rect) ? a : acc), null)
  if (best && overlap(best, rect) * 2 >= rect.width * rect.height) return { ...clampInto(best, rect), ...flags }
  return { ...centerIn(primary.workArea, rect.width, rect.height), ...flags }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Une route restaurable : page d'un projet, interne à l'application. */
export function isRestorableRoute(route: unknown): route is string {
  return isValidAppRoute(route) && !!routeProjectId(route)
}

/** Lecture tolérante du contenu de `windows-state.json` : toute entrée invalide est ignorée. */
export function parseSavedWindows(raw: unknown): SavedWindow[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { windows?: unknown }).windows
  if (!Array.isArray(list)) return []
  const out: SavedWindow[] = []
  for (const item of list) {
    if (out.length >= MAX_SAVED_WINDOWS) break
    if (!item || typeof item !== 'object') continue
    const w = item as Record<string, unknown>
    if (![w.x, w.y, w.width, w.height].every(isFiniteNumber)) continue
    const width = Math.max(MIN_WIDTH, Math.round(w.width as number))
    const height = Math.max(MIN_HEIGHT, Math.round(w.height as number))
    out.push({
      x: Math.round(w.x as number),
      y: Math.round(w.y as number),
      width,
      height,
      ...(w.maximized === true ? { maximized: true } : {}),
      ...(w.fullScreen === true ? { fullScreen: true } : {}),
      ...(isRestorableRoute(w.route) ? { route: w.route } : {}),
    })
  }
  return out
}
