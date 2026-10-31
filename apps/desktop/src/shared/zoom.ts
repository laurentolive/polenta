import type { ZoomAction } from '@polenta/types'

/**
 * GH237 — zoom de l'interface, préférence app-level : paliers fixes (ceux de Chromium, bornés à
 * 50–300 %). Partagé main / renderer.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const ZOOM_DEFAULT = 1

/** Palier le plus proche dans [0,5 ; 3] ; 1 si la valeur n'est pas un nombre fini. */
export function normalizeZoomFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZOOM_DEFAULT
  let best: number = ZOOM_STEPS[0]
  for (const step of ZOOM_STEPS) if (Math.abs(step - value) < Math.abs(best - value)) best = step
  return best
}

/** Palier suivant / précédent (sans effet aux bornes), ou 100 %. */
export function stepZoom(factor: number, action: ZoomAction): number {
  if (action === 'reset') return ZOOM_DEFAULT
  const i = ZOOM_STEPS.indexOf(normalizeZoomFactor(factor) as typeof ZOOM_STEPS[number])
  const j = action === 'in' ? Math.min(i + 1, ZOOM_STEPS.length - 1) : Math.max(i - 1, 0)
  return ZOOM_STEPS[j]
}
