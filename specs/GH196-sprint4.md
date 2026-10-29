# GH196 — Sprint 4 : classeur pré-rempli avec les résultats déjà saisis

Demande de l'humain à la validation (2026-10-29) : l'export ne reprenait pas les résultats déjà saisis.
Décision : pré-remplir, et ignorer au réimport une instance non modifiée.

## Fichiers modifiés

- `export/campaign-execution.xlsx.ts` : `ExecutionSheetEntry.prefill` (run de l'entrée), `RowPrefill`
  sur les lignes ; verdict, testeur, date (heure locale), commentaire (texte simple) et champs recopiés ;
  signature des valeurs écrites (relues par `readSheetRows`) dans `_polenta` (colonne `prefill`).
- `export/campaign-execution-import.ts` : `readSheetRows` extrait (partagé avec l'export),
  `instanceSignature`, instance pré-remplie non modifiée ignorée (`unchangedCount`).
- `campaign-execution.service.ts` : run de chaque entrée exécutée lu à l'export.
- Types : `ExecutionImportPreview.unchangedCount` ; renderer : compteur dans l'aperçu d'import.
- SPEC-TESTS §4.5 complété.

## Tests

`export/campaign-execution.gh196.test.ts` : pré-remplissage, réimport sans modification (ignoré),
modification (importée avec testeur et date d'origine).
