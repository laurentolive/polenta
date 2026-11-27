# GH463 — Scénarios de test

Fichier e2e : `apps/desktop/e2e-web/gh463-create-top.spec.ts`. Clics souris (pas seulement clavier).
Type et exigences créés par IPC, comme `gh415-tree-delete-obsolete.spec.ts` : un type dédié, 60 exigences
et plus, pour que la liste dépasse la hauteur de la fenêtre.

## Niveau 1 — ciblé (pendant le développement)

- `pnpm typecheck` et `pnpm lint`.
- `npx vitest run --changed main` depuis `apps/desktop`.

## Niveau 2 — ticket

| # | Vue / contexte | Action | Attendu |
|---|---|---|---|
| T1 | Tableau, liste défilée tout en bas | Clic sur « + Nouvel élément » (en haut, toujours visible) → « Élément » | Le nœud est en tête de l'arbre ; son titre est en édition (champ focalisé). |
| T2 | Tableau, suite de T1 | Attendre 500 ms | La ligne du nouvel élément est sélectionnée et visible dans le Tableau (`toBeInViewport`) ; le champ de titre garde le focus. |
| T3 | Tableau | Saisir le titre puis Entrée | Le titre apparaît dans la ligne du Tableau et dans l'arbre. |
| T4 | Document | Même création depuis la vue Document | L'élément est sélectionné et visible dans le Document. |
| T5 | Tableau, filtre global « GH463 ligne 1 » actif | Création | Filtre effacé (champ vide), élément visible et sélectionné. |
| T6 | Tableau, filtre de colonne (statut) qui exclut « Brouillon » | Création | Filtre de colonne effacé, élément visible et sélectionné. |
| T7 | Édition | Création | L'objet créé s'ouvre (`item` dans l'URL = l'objet créé) — comportement inchangé. |
| T8 | Tableau, après T2 | Tableau → Document → Tableau, puis Précédent | L'élément reste sélectionné et visible à chaque arrivée. Échantillonnage à chaque frame pendant le défilement : une fois visible, la ligne ne sort plus de la zone. |
| T9 | Tableau, filtre global actif | Clic droit sur zone vide → « Élément », puis « + » d'interstice | Pas de sélection ajoutée, filtre global **conservé** (les autres points d'entrée ne changent pas). |

Lessons appliquées : position testée à chaque frame (T8, 2026-11-06) ; clic souris (T1) ; le filtre est
testé sur le symptôme (le nouvel élément est visible), pas sur le champ modifié seul (2026-11-06 et
2026-11-19).

## Niveau 3 — complet

Au merge sur `main`, avec le lot, à la validation finale : `pnpm --filter @polenta/desktop test:e2e:web`.
