# GH202 — Scénarios de test

## Automatiques (`tested-config.gh202.test.ts`, `campaign-execution.gh202.test.ts`)

1. Créer, copier, inclure, retirer : `history.changes` reçoit une entrée par écriture, liste triée ; deux écritures
   dans la même seconde n'en font qu'une.
2. Fusion de deux branches : `history.changes` est l'union (merge-core, existant).
3. `resolve` : version, label, état, commit, `changesAt`, composants récursifs ; aucune écriture de version.
4. Écarts : autre version → `expected` ; texte libre → `undocumented` ; composition vide → `expected: null`.
5. Requis : refus sans saisie si une version est sélectionnable ; accepté sinon ; version abandonnée non résolue.
6. Dérive : composant changé, changement ajouté et retiré avec date et auteur, version supprimée ou abandonnée ;
   pour un composant en écart, comparaison sur `expected`.
7. Pré-remplissage : dernière exécution de la campagne ; vide si première, abandonnée ou supprimée.
8. Test de composant dans une campagne produit : version produit, run dans le repo du composant.
9. Classeur : colonnes, relecture, écart signalé, `tested_version_missing`, v3 sans `testedConfig`, instance pré-remplie
   non modifiée reconnue.
10. Graphe : `testedConfig` exposé, `null` si absent ; `polenta.d.ts` à jour.

## Manuels (application desktop)

1. **Saisie** : dans une campagne d'un repo avec versions, ouvrir l'exécution d'un test : le bloc « Version testée »
   est vide. Enregistrer sans version : refus. Choisir une version et enregistrer.
2. **Pré-remplissage** : exécuter un second test : version reprise.
3. **Écarts** : déplier la structure, changer un composant, puis saisir un texte libre : lignes surlignées, écarts
   visibles dans la grille d'exécutions et dans la consultation du run.
4. **Évolution** : inclure un changement dans la version, puis rouvrir la grille : « a évolué » et le détail.
5. **Excel** : exporter, remplir (dont une version inconnue), importer : écart signalé à l'aperçu.
6. **Sans version** : dans un repo sans type version, l'écran ne montre pas le bloc et le classeur pas les colonnes.
