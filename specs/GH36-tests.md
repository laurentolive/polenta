# GH36 — Scénarios de test

Spec : `specs/GH36.md` (CA = critères d'acceptation §5). Design : `specs/GH36-design.md`.

Deux niveaux :
- **Auto** : `apps/desktop/scripts/check-gh36.ts` (tsx, sans Electron) — appelle les fonctions
  pures (`buildExecutionSheetModel`, `validateExecutionImport`, `parseStepVerdict`…) et
  `writeExecutionWorkbook` / `readExecutionWorkbook` sur des fichiers temporaires ; le « remplissage
  par le testeur » est simulé en écrivant des cellules avec exceljs.
- **Manuel** : dans l'app (projet de démo lave-linge), avec ouverture réelle dans Excel.

Jeu de données de référence (fixture du script) : campagne `CAMP-T` `in_progress`, 4 instances :
- `A` = `TEST-1-1` : 3 étapes, sans paramètre, statut `pending` ;
- `B` = `TEST-2-1` : 2 étapes, paramètre résolu `{tension}` = `230 V` et saisi `{lot}` = `L42`, `pending` ;
- `C` = `TEST-3-1` : test itérant, `requirementId: SYS-0007`, 1 étape, déjà `PASS` ;
- `D` = `TEST-4-1` : 2 étapes, `pending`, test sans `testSnapshot` (résolu en live).

## Sprint 1 — Export

| # | Scénario | Attendu | Niveau | CA |
|---|----------|---------|--------|----|
| E1 | Export de `CAMP-T` | 4 lignes d'instance, 3+2+1+2 lignes d'étape, dans l'ordre de `runs[]` ; clés `TEST-1-1`, `TEST-1-1#1`… en colonne A masquée | Auto | 1 |
| E2 | Paramètres de `B` | texte des étapes : `230 V` et `L42` substitués ; colonne Paramètres `lot = L42` / `tension = 230 V` (triés) | Auto | 1 |
| E3 | Instance `C` | colonne Exigence = `SYS-0007` ; Statut actuel = libellé `PASS` dans la langue d'export | Auto | 1 |
| E4 | Instance `D` sans snapshot | titre et étapes lus sur le test live | Auto | 1 |
| E5 | Test source introuvable (fixture variante) | ligne d'instance « (test introuvable) », aucune ligne d'étape, `orders` vide dans `_polenta` | Auto | — |
| E6 | Richtext avec gras, liste, image, diagramme draw.io | texte brut, liste préfixée, `[image]`, `[diagramme]` | Auto | 1 |
| E7 | Protection | feuille protégée ; seules I/J/K/L (instance) et I/L (étape) ont `locked = false` | Auto | 2 |
| E8 | Listes déroulantes | I d'instance : liste globale (4 valeurs) ; I d'étape : liste étape (5 valeurs) ; libellés de la locale demandée | Auto | 2 |
| E9 | Feuille `_polenta` | `veryHidden`, `formatVersion = 1`, `campaignId = CAMP-T`, une ligne par instance avec `orders` | Auto | — |
| E10 | Export en `en` | en-têtes, listes et bandeau en anglais | Auto | 12 |
| E11 | Ouverture dans Excel | s'ouvre sans réparation ; lignes d'étape repliables ; cellules grisées non éditables ; liste déroulante fonctionnelle ; filtre sur une colonne OK | Manuel | 1, 2 |
| E12 | Menu sur une campagne `completed` | bouton « Excel d'exécution » absent | Manuel | — |
| E13 | Dialogue d'enregistrement annulé | aucun message d'erreur | Manuel | — |
| E14 | Nom proposé | `CAMP-xxxx_execution_<date du jour>.xlsx` | Manuel | — |
| E15 | Non-régression | « Exporter » → cahier xlsx/docx/pdf et rapport inchangés ; exécution d'un test dans l'outil inchangée (helpers déplacés) | Manuel | — |

## Sprint 2 — Import

Pour chaque cas, partir du fichier exporté en E1 puis le modifier avec exceljs (Auto) ou à la main (Manuel).

| # | Scénario | Attendu | Niveau | CA |
|---|----------|---------|--------|----|
| I1 | `A` : étapes PASS/PASS/FAIL, global vide ; `B` : global `PASS`, étapes vides ; `C`, `D` vides | aperçu : 2 importables (`A` → FAIL calculé, `B` → PASS forcé, étapes `NOT_EXECUTED`), 2 non remplies | Auto | 3, 5 |
| I2 | I1 appliqué | 2 `TestRun` sous `test-runs/TEST-1/`, `test-runs/TEST-2/` avec `origin: excel-import` ; `A` = `FAIL`, `B` = `PASS`, `runId` posés ; `C` toujours `PASS`, `D` `pending` ; campagne `in_progress` | Manuel | 3 |
| I3 | Lignes du fichier I1 réordonnées (étapes de `A` inversées, `B` avant `A`) | aperçu identique à I1 | Auto | 4 |
| I4 | Global `PASS` forcé avec une étape FAIL | `result = PASS`, `resultForced = true` | Auto | 5 |
| I5 | Testeur / date vides | `executedBy` = utilisateur de repli, `executedAt` = `now` du contexte | Auto | 6 |
| I6 | Testeur `Alice`, date cellule Excel `2026-10-05` ; autre instance date texte `05/10/2026 14:30` | `executedBy = Alice` ; `executedAt` = 2026-10-05 12:00 locale ; 14:30 locale pour la seconde | Auto | 6 |
| I7 | `C` (déjà `PASS`) remplie `FAIL` | importable, `previousStatus = PASS` ; aperçu affiche « remplace le résultat existant » ; après apply : nouveau run, `C` = `FAIL` | Auto + Manuel | 7 |
| I8 | Réimport du même fichier après I2 | `A` et `B` signalées « remplace… » ; 2 nouveaux runs (numéros suivants) | Manuel | 7 |
| I9 | `campaignId` de `_polenta` modifié en `CAMP-X` | `fatal: wrong_campaign`, aucune importable ; Manuel : modale n'affiche que l'erreur, rien écrit | Auto + Manuel | 8 |
| I10 | Campagne passée `completed` entre export et import | `fatal: campaign_closed` | Auto | 8 |
| I11 | Feuille `_polenta` supprimée / fichier quelconque / fichier corrompu | `not_an_execution_sheet` / `unreadable` | Auto | 8 |
| I12 | `formatVersion = 99` | `unsupported_version` | Auto | — |
| I13 | `D` retirée de la campagne après export, puis remplie | `D` en erreur `entry_not_found` ; les autres importables | Auto | 9 |
| I14 | Une ligne d'étape de `A` supprimée (ou clé `TEST-1-1#2` altérée en `#9`) | `A` en erreur `steps_mismatch` (expected `[1,2,3]`) | Auto | 9 |
| I15 | Verdict d'étape `foo` dans `B` | `B` en erreur `invalid_verdict` avec n° de ligne et valeur | Auto | 10 |
| I16 | Date `32/13/2026` | `invalid_date` | Auto | — |
| I17 | Verdicts saisis en codes (`FAIL`), libellés FR (`échoué `), libellés EN (`Failed`) | tous reconnus | Auto | 12 |
| I18 | Ligne ajoutée par le testeur (sans clé) avec un commentaire | avertissement `row_without_key` avec son n° de ligne | Auto | — |
| I19 | Commentaire multi-ligne avec `*`, `#`, `<b>`, `- item` | Markdown échappé : rendu identique au texte saisi dans la relecture du run | Auto + Manuel | — |
| I20 | Instance de test introuvable (E5) remplie | erreur `test_not_found` | Auto | — |
| I21 | Instance itérante `C` importée | run avec `requirementId: SYS-0007` ; matrice de traçabilité : le résultat compte pour `SYS-0007` seulement | Manuel | 11 |
| I22 | Relecture d'un run importé | badge « Importé depuis Excel », testeur et date du fichier, commentaires affichés | Manuel | — |
| I23 | Aucune instance remplie | bouton « Importer 0 résultat » désactivé | Manuel | — |
| I24 | Instance retirée de la campagne **entre l'aperçu et la confirmation** | apply revalide : instance non écrite, message « la campagne a changé depuis l'aperçu » | Manuel | — |
| I25 | Exporté en FR, UI passée en EN, réimport | import OK, modale en anglais | Manuel | 12 |
| I26 | Dialogue d'ouverture annulé | rien ne s'ouvre | Manuel | — |
| I27 | Non-régression exécution dans l'outil | run créé sans `origin`, `executedAt` = maintenant, statut d'instance mis à jour comme avant | Manuel | — |

## Critères de sortie

- `check-gh36.ts` : 100 % PASS ; typecheck sans nouvelle erreur ; build OK.
- Fichier exporté ouvert sans réparation dans Excel (version disponible localement) ; essai de bout
  en bout export → saisie dans Excel → import dans l'app packagée ou en dev.
