# GH243 — Scénarios de test

## Unitaires (main)

| # | Scénario | Attendu |
|---|---|---|
| U1 | `nextVersion` : approuvé → brouillon / review / obsolète | `version + 1` |
| U2 | `nextVersion` : brouillon → review, review → approuvé, même statut | inchangée |
| U3 | `RequirementsService.openDraft` sur une exigence approuvée v3 | v4 |
| U4 | `RequirementsService.openDraft` sur un brouillon v4 | v4 (plus d'incrément) |
| U5 | `transition` approuvé → obsolète | v+1 |
| U6 | `TestsService.update({ status })` approuvé → brouillon ; `openDraft` sur brouillon | v+1 ; inchangée |
| U7 | Verrou : titre d'une exigence approuvée | refusé (inchangé) |
| U8 | MCP `update_requirements` statut brouillon + titre sur une approuvée | rouverte (v+1) puis titre écrit |
| U9 | MCP `bulk_import_requirements` avec un `changesetId` | paramètre inconnu refusé par le schéma zod |
| U10 | Campagne créée sans `baselineRef` ; fichier existant avec `baselineRef` + `changeset` | lecture sans ces champs ; réécriture sans eux |
| U11 | Schéma avec un type `category: changeset` et `changeTracking: on` | type et préférence absents du schéma lu ; aucune erreur |
| U12 | Graphe | pas de collection `changesets` ; `GraphCampaign` sans `changeset` / `baselineRef` ; manifeste +1 |

## E2E (client web)

| # | Scénario | Attendu |
|---|---|---|
| E1 (R1) | Vue Word, exigence approuvée | bandeau verrouillé, pas de bouton « Rouvrir » ; statut → brouillon : version +1, titre éditable |
| E2 (R2) | Vue Excel, test approuvé, colonne Statut → review | version +1, aucun dialogue |
| E3 (R6) | Créer une exigence depuis le formulaire avec un repo contenant un ancien type changeset | créée sans dialogue |
| E4 (R7) | Barre d'activité et panneaux | pas d'entrée Changesets ; Version : « Modifications locales », « Impact à vérifier » ouvrent leurs écrans ; Exigences : Constellation |
| E5 (R8) | Nouvelle campagne | pas de champ baseline ; création OK |

## Cas limites

- Repo avec des fichiers `changesets/` : aucune lecture, aucune erreur (R10).
- Exigence brouillon remise en brouillon : aucune écriture de version.
- Ancien lien `/changeset/…` ou onglet restauré pointant sur une route retirée : onglet ignoré à la
  restauration (`TabsContext`), pas d'écran d'erreur.

## Critères vérifiables

- `rg "changeset|changeTracking|ApprovalGate" apps packages` : plus de code (seulement commentaires
  historiques et specs).
- `pnpm typecheck`, `pnpm test`, e2e GH243 et suites e2e existantes vertes.
