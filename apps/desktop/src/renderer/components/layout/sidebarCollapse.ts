/**
 * GH123 — panneau latéral replié/déplié (style VS Code : reclic sur l'icône active, Ctrl+B).
 * Préférence d'interface par poste, commune à tous les projets, en localStorage. Logique pure
 * (pas de DOM réel) pour être testée par vitest.
 */

export const SIDEBAR_COLLAPSED_KEY = 'polenta.sidebarCollapsed'

/** "1" → replié ; absente, autre valeur ou localStorage indisponible → déplié. */
export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Déplié = clé supprimée : l'absence est le défaut. */
export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    else localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
  } catch { /* storage unavailable: preference not kept */ }
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Champ de saisie : Ctrl+B y appartient au champ (gras de l'éditeur richtext), pas au panneau. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown }
  if (el.tagName && EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[contenteditable]:not([contenteditable="false"])')
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Ctrl+B, ou Cmd+B sur macOS (où Ctrl+B est « curseur en arrière »). Touche physique B
 *  (`code`) acceptée pour les dispositions non latines ; auto-répétition ignorée. */
export function isSidebarToggleShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'target'>,
  isMac = IS_MAC,
): boolean {
  if (e.defaultPrevented || e.repeat || e.shiftKey || e.altKey) return false
  if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  if (e.key.toLowerCase() !== 'b' && e.code !== 'KeyB') return false
  return !isEditableTarget(e.target)
}
