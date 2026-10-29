# GH224 — Design : filtre de la colonne « Couverture »

Un seul sprint.

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/ExcelView.tsx`
  - `isFilterableColumn` : `coverageStatus` n'est plus exclu (seule `steps` le reste).
  - `getCellDisplayText` : pour `coverageStatus`, renvoie le libellé traduit du badge
    (`system.coverage.status.<statut>`) lu dans `coverageByReqId`, chaîne vide si l'objet n'a pas
    d'entrée de couverture. Le filtre de colonne (T51) utilise déjà `getCellDisplayText` : aucun
    autre changement du mécanisme de filtre.
- `apps/desktop/e2e-web/gh224-coverage-filter.spec.ts` : scénario e2e.

## Décisions

- Filtre texte sur le libellé (comme Statut, GH136) plutôt que sur la valeur technique
  (`not_covered`…) : l'utilisateur tape ce qu'il voit. Effet de bord voulu : la largeur auto de la
  colonne tient compte du libellé (même fonction).
- Pas de nouvelle interface ni de type ; pas de recalcul de couverture côté renderer.

## Alternative rejetée

- Liste de cases à cocher des 5 statuts : hors scope (spec), mécanisme distinct des autres
  colonnes.
