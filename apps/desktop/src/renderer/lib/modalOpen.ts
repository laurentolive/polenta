/** Une modale ou un menu à fond cliquable est affiché : les raccourcis de navigation globaux
 *  (Précédent / Suivant GH228, changement d'onglet GH405) ne font rien. */
export function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"], .fixed.inset-0')
}
