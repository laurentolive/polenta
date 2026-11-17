/**
 * GH343 — saut de l'accueil vers le dernier projet ouvert : seulement au lancement, dans la fenêtre
 * qui y a droit, et une seule fois. Une fenêtre qui revient à l'accueil en cours de session
 * (fermeture du projet, nouvelle fenêtre, fenêtre rouverte sur l'accueil) y reste — sinon elle
 * partait dans le projet d'une autre fenêtre (le pointeur « dernier projet » est commun).
 *
 * Desktop : le main passe `__jump=1` à la fenêtre de lancement (`app-windows.ts`). Web : le premier
 * chargement d'un onglet du navigateur sur `/`, sauf « Nouvelle fenêtre » (`__home=1`).
 * État du module = état du renderer, donc propre à chaque fenêtre.
 */

let allowed = false

export function initStartupJump(allow: boolean): void {
  allowed = allow
}

/** Vrai une seule fois, si la fenêtre y a droit : à appeler au moment de lire le dernier projet. */
export function consumeStartupJump(): boolean {
  const result = allowed
  allowed = false
  return result
}
