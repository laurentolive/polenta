# GH428 — Sprint 1 : modèle, saisie en campagne, fusion à l'exécution

## Livré
- `SchemaField.campaignInput` (types), `CampaignTestRun.runInputs` (types).
- `runFieldIssues` : « renseigné en campagne » refusé hors `runFields` et hors types admis (Q7).
- `mergeCampaignInputs` (`run-fields.ts`) : saisie (dto) prioritaire, sinon valeur de l'entrée (§2.2).
- `CampaignsService.updateRunInputs` : conversion `convertFieldValue`, refus sans écriture, valeur vide retire la clé.
- IPC `campaigns:update-run-inputs` : handler, `GRAPH_WRITE_CHANNELS`, client (`api-client` et son type), politique serveur web.
- `TestsService.execute` : lit `runInputs` de l'entrée dans `campaigns/<id>.yaml` du repo ouvert, fusionne, contrôle.

## Vérification
- `run-inputs.gh428.test.ts` : 22 tests (S1–S4, fusion, C1–C6, X1–X6). Passent.
- Existants touchés (run-fields gh196, campaigns gh73, campaign-execution gh68, politique et schéma) : 115 tests, passent.
- `pnpm typecheck` : 4 paquets OK. Lint des fichiers modifiés : OK.

## Reste (sprint 2)
- Grille des entrées : colonnes `run:<nom>`, édition, dernier run.
- Page d'exécution : préremplissage et lecture seule.
- Éditeur de schéma : case « Renseigné en campagne ».
