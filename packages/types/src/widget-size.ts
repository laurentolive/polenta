// GH435 — dimensions des widgets d'un dashboard (specs/GH435.md §2, §3.1, §3.2, §3.7).
//
// Une seule définition des constantes et des règles de bornage, utilisée par le renderer (grille,
// poignées, impression), le main (service, écriture) et le MCP (schémas). Tout est pur.

import type { WidgetSize } from './dashboard'

/** Largeur de référence du tableau de bord `W` (px) : zone actuelle de la page, `max-w-6xl` (1152) − `p-6`
 *  (2 × 24). Maximum de largeur d'un widget et base de l'échelle d'impression (Q1). */
export const DASHBOARD_REF_WIDTH = 1104
/** Espacement entre cartes (px). */
export const DASHBOARD_GAP = 16
/** Zone du dashboard plus étroite que ce seuil : chaque carte prend toute la largeur de la zone. */
export const DASHBOARD_SMALL_ZONE = 640

export const WIDGET_MIN_WIDTH = 240
export const WIDGET_MIN_HEIGHT = 160
export const WIDGET_MAX_HEIGHT = 720
export const WIDGET_DEFAULT_HEIGHT = 256

/** Largeur par défaut d'un préréglage : ¼, ½ et pleine largeur de `W`, espacements compris. */
export const WIDGET_PRESET_WIDTH: Record<WidgetSize, number> = { sm: 264, md: 544, lg: 1104 }

export type WidgetDimKind = 'width' | 'height'

/**
 * Largeur bornée à l'entier : de 240 px à `max` (jamais plus que `W`). Si `max` est plus petit que le
 * minimum (zone très étroite), la largeur disponible l'emporte.
 */
export function clampWidgetWidth(value: number, max: number = DASHBOARD_REF_WIDTH): number {
  const hi = Math.min(max, DASHBOARD_REF_WIDTH)
  const lo = Math.min(WIDGET_MIN_WIDTH, hi)
  return Math.min(Math.max(Math.round(value), lo), hi)
}

/** Hauteur bornée à l'entier : de 160 à 720 px. */
export function clampWidgetHeight(value: number): number {
  return Math.min(Math.max(Math.round(value), WIDGET_MIN_HEIGHT), WIDGET_MAX_HEIGHT)
}

/**
 * Dimension lue d'un fichier (YAML, `.pref`) ou reçue d'un appelant : un nombre fini est borné, tout le
 * reste (absent, chaîne, `NaN`, `null`) est ignoré — le widget garde alors sa dimension par défaut.
 */
export function readWidgetDim(value: unknown, kind: WidgetDimKind): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return kind === 'width' ? clampWidgetWidth(value) : clampWidgetHeight(value)
}

/** Largeur demandée par un widget : la sienne, sinon celle de son préréglage. */
export function widgetRequestedWidth(widget: { size: WidgetSize; width?: number }): number {
  return widget.width ?? WIDGET_PRESET_WIDTH[widget.size]
}

/**
 * Largeur affichée dans une zone de `zoneWidth` px : zone étroite → pleine largeur ; sinon la largeur
 * demandée, bornée par le minimum et la zone (la largeur demandée n'est jamais modifiée).
 */
export function widgetDisplayWidth(requested: number, zoneWidth: number): number | '100%' {
  if (zoneWidth < DASHBOARD_SMALL_ZONE) return '100%'
  return clampWidgetWidth(requested, zoneWidth)
}

// ─── Impression (specs/GH435.md §3.7, Q3) ────────────────────────────────────

/** Marge de page, de chaque côté (mm), identique sur le desktop et le web. */
export const PRINT_MARGIN_MM = 10
export const PRINT_PAGE_WIDTH_MM = 210
/** Taille minimale du texte imprimé (px, échelle appliquée). */
export const PRINT_MIN_FONT_PX = 8

const CSS_PX_PER_MM = 96 / 25.4

/** Largeur utile de la page A4 (px CSS, marges retirées) : 718,1. */
export function printContentWidth(): number {
  return (PRINT_PAGE_WIDTH_MM - 2 * PRINT_MARGIN_MM) * CSS_PX_PER_MM
}

/**
 * Échelle du moteur d'impression : largeur utile de la page / `W`, arrondie vers le BAS (au millième) pour
 * que la mise en page du moteur (`largeur utile / échelle`) contienne toujours `W`.
 */
export function printScale(refWidth: number = DASHBOARD_REF_WIDTH): number {
  return Math.floor((printContentWidth() / refWidth) * 1000) / 1000
}

export const PRINT_SCALE = printScale()

/** Largeur de mise en page vue par la page imprimée (px CSS) : 1104,8 pour 1104 de grille. */
export function printLayoutWidth(scale: number = PRINT_SCALE): number {
  return printContentWidth() / scale
}

/** Taille de police de mise en page (px) qui donne `PRINT_MIN_FONT_PX` une fois l'échelle appliquée. */
export function printFontFloor(scale: number = PRINT_SCALE): number {
  return Math.ceil(PRINT_MIN_FONT_PX / scale)
}
