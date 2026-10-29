# GH224 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/ExcelView.tsx` — `isFilterableColumn`, `getCellDisplayText`
- `apps/desktop/e2e-web/gh224-coverage-filter.spec.ts` — nouveau
- `specs/SPEC-SYSTEM-VIEW.md` §Filtre par colonne, `specs/SPEC-INDEX.md`

## Comportement implémenté

La colonne `Couverture (sys)` de la vue tableau porte l'icône de filtre de colonne ; le filtre
s'applique au libellé affiché par le badge (langue de l'interface). Ligne sans badge = texte vide.
La largeur auto de la colonne tient désormais compte du libellé.

## Divergences

Aucune avec le design.

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` §Filtre par colonne : Couverture filtrable sur le libellé du badge,
  « contient » (`couvert` garde aussi « Non couvert », regex `^couvert` pour isoler).

## Tester manuellement

Onglet Exigences → vue Tableau → ⚙️ cocher « Couverture » si masquée → icône de filtre de l'en-tête
Couverture → saisir `non`, `valid`, puis regex `^couvert`. Scénarios 6–8 de `GH224-tests.md`.
