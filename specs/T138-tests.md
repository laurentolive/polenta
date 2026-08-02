# T138 — Scénarios de test

## Scénarios nominaux (golden path)

1. **Champ décoché par défaut** — ouvrir la Vue Système (Excel ou Word) sur un projet existant sans
   rien configurer : aucune icône de couverture visible, aucune colonne "Couverture" dans Excel.
   Panneau ⚙️ liste bien `coverageStatus` comme champ disponible mais non coché.
2. **Activer dans Excel** — cocher `coverageStatus` dans le panneau ⚙️, onglet Excel : une colonne
   "Couverture" apparaît, une icône par ligne d'exigence, cellule vide pour les lignes de type test.
3. **Activer dans Word** — cocher `coverageStatus` dans le panneau ⚙️, onglet Word : une icône
   apparaît dans l'en-tête de chaque carte d'exigence, à côté du badge de statut de cycle de vie.
4. **Vue Édition** — ouvrir une exigence en édition : le badge de couverture est visible près du
   titre, sans case à cocher dédiée (limitation connue, documentée) — comportement identique avant/
   après avoir touché au panneau ⚙️ pour cette vue précise.
5. **Cas exigence non couverte** — exigence sans aucun test lié → icône `not_covered`, tooltip
   "Aucun test lié".
6. **Cas exigence couverte non exécutée** — exigence liée à un test jamais exécuté → icône `covered`,
   tooltip listant ce test avec son statut `not_run`.
7. **Cas exigence validée** — exigence liée à un ou plusieurs tests dont le dernier run de chacun est
   PASS → icône `validated`.
8. **Cas exigence en échec** — exigence liée à un test dont le dernier run est FAIL → icône `failing`,
   même si un autre test lié est PASS.
9. **Cas revalidation** — lien marqué `needsRevalidation: true` → icône `needs_revalidation`,
   prioritaire même sur un `failing` simultané.
10. **Mise à jour en direct** — avec la vue Excel ouverte et le champ coché, exécuter un test lié
    depuis l'onglet Test (nouvel onglet ou fenêtre) puis revenir : l'icône reflète le nouveau
    résultat sans action manuelle de rafraîchissement (dépend du re-fetch react-query au focus/
    remount — à vérifier que ça ne nécessite pas un F5).

## Cas limites

- **Exigence liée à un test supprimé entre-temps** (lien orphelin) : `cells[].testCaseId` ne résout
  à rien dans `testsById` — le tooltip ne doit pas planter (afficher l'ID brut ou omettre la ligne),
  et le statut agrégé (`coverageStatus`) reste celui déjà calculé côté `computeCoverage()` (le lien
  orphelin est simplement absent de `tcMap` côté service, donc déjà filtré en amont — à vérifier que
  ça ne fait pas planter `getMatrix()` lui-même, comportement pré-existant hors scope de ce ticket).
- **Composant en lecture seule** (`readonly: true`) : badge visible identiquement, aucune régression
  sur le fait que la vue reste non éditable par ailleurs.
- **Projet sans aucun test défini** : toutes les exigences en `not_covered`, aucune erreur, aucun
  appel `traceability:matrix` en échec sur un dataset vide.
- **Grand nombre d'exigences/tests (workspace multi-composants)** : `enabled: false` sur le
  `useQuery` tant qu'aucune des 3 vues n'a le champ coché — vérifier qu'aucun appel
  `traceability:matrix` n'est déclenché dans ce cas (via les devtools réseau/IPC), pour ne pas payer
  le coût de `getMatrix()` sur un gros repo par défaut.
- **Basculement rapide coché/décoché** : cocher puis décocher immédiatement dans le panneau ⚙️ ne
  doit pas laisser un badge "fantôme" affiché ni une requête en vol qui écrase un état incohérent.
- **Changement de type d'objet affiché** (exigence ↔ test dans la même vue) : les lignes/cartes de
  type `test` n'affichent jamais de badge, même si `coverageStatus` est coché globalement pour la
  vue.
- **Exigence appartenant à un composant submodule** (workspace multi-repo) : `coverageByReqId` doit
  couvrir aussi ces exigences (`getMatrix()` agrège déjà tous les repos du workspace via
  `resolveRepoPaths()`), pas seulement le repo racine.

## Critères d'acceptation vérifiables

Repris de `specs/T138.md` §Critères d'acceptation — à cocher un par un en fin de sprint :

- [ ] `coverageStatus` listé dans le panneau ⚙️ pour Excel et Word, non coché par défaut.
- [ ] Décoché : rendu Excel/Word strictement identique à l'existant (diff visuel nul).
- [ ] Coché : icône correcte pour les 5 statuts (`not_covered`/`covered`/`validated`/`failing`/
  `needs_revalidation`), sur des fixtures couvrant chaque cas.
- [ ] `EditView` affiche le badge (toujours visible, limitation documentée pour l'onglet manquant).
- [ ] Aucun contrôle éditable sur ce champ dans les 3 vues (pas de `<select>`, pas de focus, pas
  d'`onClick` de sauvegarde).
- [ ] Tooltip correct, y compris le cas "aucun test lié".
- [ ] Aucune régression sur les champs déjà rendus (`status`, `version`, liens, richtext…) dans les
  3 vues.
- [ ] `computeCoverageStatus()`/`computeCoverage()` non dupliqués côté renderer — seule
  consommation via `api.traceability.matrix`.
- [ ] TypeScript/lint : zéro nouvelle erreur.
