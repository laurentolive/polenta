/**
 * GH237 — raccourcis clavier du zoom de l'interface. Écoutés sur `window` en capture (un widget
 * qui arrête la propagation, comme le terminal xterm, ne les bloque pas) ; une frappe dans
 * l'iframe de l'éditeur draw.io n'y arrive pas, draw.io garde ainsi ses propres raccourcis.
 * Logique pure pour être testée par vitest.
 */

import type { ZoomAction } from '@polenta/types'
import { IS_MAC, hasCommandModifier } from './sidebarCollapse'

/** Ctrl (Cmd sur macOS) + `=` / `+` → in, `-` → out, `0` → reset ; pavé numérique et touche
 *  physique 0 (`Digit0` : `à` en AZERTY sans Maj) acceptés. Alt exclu (AltGr = Ctrl+Alt). */
export function zoomShortcutAction(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  isMac = IS_MAC,
): ZoomAction | null {
  if (e.altKey || !hasCommandModifier(e, isMac)) return null
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') return 'in'
  if (e.key === '-' || e.code === 'NumpadSubtract') return 'out'
  if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset'
  return null
}
