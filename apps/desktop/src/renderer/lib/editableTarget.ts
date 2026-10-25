const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Champ de saisie (input, textarea, select, contenteditable — dont l'éditeur richtext TipTap) :
 * les raccourcis globaux (Ctrl+B GH123, Ctrl+Z/Y/S de l'arbre GH152) y appartiennent au champ.
 * Duck-typing pour être testable sans DOM.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown }
  if (el.tagName && EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true
  if (el.isContentEditable) return true
  return !!el.closest?.('[contenteditable]:not([contenteditable="false"])')
}
