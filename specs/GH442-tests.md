# GH442 — Scénarios de test

Jeu : un type de test, trois tests `A` (non itérant, 2 exigences liées `R1`, `R2`, le lien de `R2`
créé dans le sens exigence → test), `B` (non itérant, aucun lien), `C` (itérant `{req.priority}`, liés à
`R1` et `R3`), `D` (lié seulement à `R4`, exigence terminale).

## Unitaires (niveau 1)

| # | Cible | Cas | Attendu |
|---|---|---|---|
| U1 | `entryRequirementIds` | run avec `requirementId` ; sans ; sans et `covered` absent | `[R]` ; `covered` ; `[]` |
| U2 | `ParametersService.coveredRequirementIds` | A, B, C, D | `A:[R1,R2]` (lien inversé compris), `B:[]`, `C:[R1,R3]`, `D:[]` (terminale exclue) |
| U3 | idem | `R10` et `R2` liés | tri naturel : `R2`, `R10` |
| U4 | `CampaignsService.entryRequirements` | campagne avec A, B, deux instances de C (`R1`, `R3`), D | A → `[R1,R2]`, B → `[]`, instances C → `[R1]` et `[R3]` (jamais `R1,R3`), D → `[]` |
| U5 | idem | instance C dont l'exigence est devenue terminale | l'exigence itérée reste affichée |
| U6 | idem | lien ajouté après la création de la campagne | apparaît au prochain appel (rien de figé) |
| U7 | classeur d'exécution (`buildExecutionSheetModel`) | A (2 exigences), instance C | colonne `requirement` = `R1, R2` et `R1` ; import du classeur : mêmes entrées, `requirementId` des entrées inchangé |
| U8 | `campaign.xlsx` (`exportCampaignPlanXlsx`) | A, B, C | colonne Exigence = `R1, R2`, vide, `R1` |
| U9 | `campaign.docx` (titre d'instance) | A, C | `A — titre · R1, R2` ; `C — titre · R1` |
| U10 | grille (`CampaignEntriesGrid`, `getText`) | A, B, C | même texte que U8 ; `DEFAULTS` sans `carried` |

## E2E (niveau 2) — `e2e-web/gh442-campaign-requirements.spec.ts`

| # | Scénario | Attendu |
|---|---|---|
| E1 | Page d'une campagne (A, B, C, D) | colonne Exigence : A → `R1`, `R2` en liens d'élément ; B vide ; instances de C → une exigence chacune ; D vide |
| E2 | Source de la cellule (intégrée à E1) | A : `data-requirement-source="covered"` ; instance de C : `instance` ; aucun `title` natif sur la cellule |
| E3 | Filtre de la colonne par `R2` | A seul |
| E4 | Lien `B → R5` créé ailleurs, retour sur la page campagne | B affiche `R5` sans recharger l'application |
| E5 | Exports du cahier (xlsx) et du classeur d'exécution (xlsx) | même texte que la grille ligne à ligne |
| E6 | Profil sans préférence | colonne « Reportée depuis » absente ; 👁 Colonnes la propose ; cochée → `↩ CAMP-xxx` sur une entrée reportée |
| E7 | Profil avec préférence contenant `carried` | colonne conservée |
| E8 | `gh389-campaigns` et `gh64-carry-over` adaptées | passent en affichant la colonne d'abord |

## Manuel (non couvert)

- Export PDF du cahier et du rapport : la mise en page est vérifiée à l'œil, le texte l'est en U8/U9.
- Workspace avec composant en repo séparé : exigence liée dans un autre repo, grille et PDF identiques.
