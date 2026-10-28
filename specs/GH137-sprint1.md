# GH137 — Sprint 1 (unique)

## Fichiers modifiés

Voir `specs/GH137-design.md` § Fichiers ; test ajouté `linkColumns.gh137.test.ts`.

## Comportement implémenté

Conforme à `specs/GH137.md` : deux colonnes « raffine » / « est raffinée par » quand le type affiché
est source et cible du lien, popover limité au sens de la colonne, compatibilité des préférences
`link::`, onglet Document et exports inchangés.

## Divergences par rapport au design

Aucune.

## Mises à jour SPEC

- `SPEC-SYSTEM-VIEW.md` §Vue Excel : paragraphe « Colonnes de lien par sens (GH137) ».
- `SPEC-INDEX.md` : ligne §Configuration des champs / §Vue Excel…, `MAJ` → GH137.

## Vérification

Portable (Node 20) : `pnpm typecheck` OK ; `pnpm test` 86/86 fichiers, 930/930 tests OK. Scénarios
2, 3 et 6 à vérifier à la main dans l'appli.
