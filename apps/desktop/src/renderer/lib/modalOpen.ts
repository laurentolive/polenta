/** Une modale ou un menu est affiché : les raccourcis de navigation globaux (Précédent / Suivant
 *  GH228, changement d'onglet GH405) ne font rien. Reconnus : `role="dialog"` / `role="menu"`, un
 *  fond cliquable plein écran (`.fixed.inset-0`, menus et popovers qui se ferment au clic à
 *  l'extérieur), et les menus flottants sans fond marqués `data-floating-menu` (menus contextuels,
 *  popovers de liens, menu du compte…). */
export function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="menu"], [data-floating-menu], .fixed.inset-0')
}
