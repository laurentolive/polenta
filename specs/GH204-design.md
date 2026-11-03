# GH204 — Design

Spec : `specs/GH204.md`. Deux sprints.

## Sprint 1 — socle

### Types (`packages/types`)

- `validation.ts` (nouveau) : `Validation`, `ValidationEntry`, `ValidationDecisionDef`, `ValidationState`
  (`open` / `signed` / `cancelled`, lu des marques du type comme `versionState`), `ValidationPage`,
  `ValidationRow`, `ValidationProblem`, `VALIDATION_ERROR_CODES`, `validationState()`, `pendingDecision()`,
  `validationTypeError()` (contrôle du schéma, partagé main / renderer).
- `schema.ts` : `ObjectCategory` + `validation` ; `ObjectTypeDefinition.decisions`, `entryFields`.
- `graph.ts` : `GraphValidation`, collection `validations`, `GraphObjectCategory`.
- `zod-schemas/validation.schema.ts` : DTO de création, mise à jour, décision.

### Services (`main/services`)

- **`validations.service.ts` (nouveau)** : lecture (`list`, `get`, `page`), `create` (avec reprise), `update`,
  `decide`, `confirm`, `reject`, `propose`, `sign`, `cancel`, `delete`. Écritures sérialisées par repo.
- **`validation-rows.util.ts` (nouveau)** : fonctions pures, testées seules : `buildRows`, `carryOver`,
  `signatureProblems`. Le service lit, ces fonctions décident.
- **`versions.service.ts`** :
  - `requirementsOf(repo, version)` : exigences du composant, lues à `freeze.sha` si released, sur disque sinon ;
  - `designVersions` réécrit (P1), avec `designVersionsFor(repo, states)` pour l'état lu par une validation ;
  - `delete` refuse une version référencée (`VERSION_HAS_VALIDATION`).
- **`version-tracking.service.ts`** : `recordAt` (contenu complet à un commit, même cache que `readAt`) ;
  `contentHash(state)` : SHA-256 tronqué de `contentKey`.
- **`schema.service.ts`** : `assertValidationTypes` (sur `root`, un seul type, marques de `validationTypeIssues`) ;
  `assertValidationTypeStable` (nom, préfixe et statuts marqués figés tant qu'il existe des validations ; décision
  utilisée par une entrée non retirable : `DECISION_IN_USE`).
- **`schema-delete` / `schema-refs` / `type-rename`** : comme le type version, un type validation qui a des objets
  ne se supprime pas (`HAS_VALIDATIONS`) et ne se renomme pas.
- **`graph.service.ts`** : `setValidations`, collection, `validations/` dans `GRAPH_PATHS`.
- **`merge-core/structure.ts`** : `entries` fusionné par `requirementId`.

### IPC, web, MCP

- Channels `validations:*` dans `main/ipc/index.ts`, `api-client`, et `WEB_HIDDEN` (spec §8).
- `mcp-server/tools/validations.tools.ts` : `list_validations`, `get_validation`, `propose_validation_decision`.
  `proposedBy` : acteur MCP (`--user`), déjà utilisé pour l'historique.

### Décisions techniques

- **`contentHash` = hash de `contentKey`** (titre, champs, étapes), sans statut ni `version` : approuver une exigence
  ne fait pas revoir sa décision. Le statut de design garde `key`, qui les inclut, comme le backlog (P1).
- **Entrées absentes = en attente** : la lecture n'écrit rien, une nouvelle exigence apparaît sans migration.
- **`sign` commite le seul fichier** (`commitSingleFile`), comme `release`, sans tag : les autres fichiers modifiés
  n'entrent pas dans le commit.
- **`decide` sur une version abandonnée ou une validation fermée** : `VALIDATION_LOCKED`.
- **Couverture** : `traceability.getMatrix` du repo, une fois par page. Rejeté : calcul par exigence, trop lent.
- **Pas d'objet « version en lecture seule » à part** : `versions.isReadonly` sert aussi aux validations.
- **`objectVersion` retiré** (Q3).

### Écart à la spec

`entryFields` renommés ou retirés : pas de migration des entrées (clé orpheline sans effet). La spec §2 annonçait les
mêmes garde-fous que les champs d'un type ; la migration coûterait plus qu'elle ne sert sur des champs de décision, et
le garde-fou utile porte sur les décisions (`DECISION_IN_USE`).

## Sprint 2 — interface

- **Barre d'activité** : panneau `validation` (icône `ShieldCheck`), masqué sur le web par
  `capabilities.productValidation` : les channels y sont masqués et l'appel produirait des erreurs (cf. #256).
- **Routes** : `validations.tsx` (accueil), `validation.$validationId.tsx`, `routeTree.gen.ts` régénéré.
- **`sidebar/ValidationPanel.tsx`** : composant (`ComponentTypeCombobox`, arbre `useVersionTree`), versions, état de leur
  validation, création.
- **`components/validation/`** :
  - `ValidationGrid.tsx` : grille, colonnes, filtres ;
  - `ValidationRunsRow.tsx` : tests et exécutions dépliés, chargés à la demande (`executions:history`) ;
  - `runMentions.ts` : mentions d'une exécution, pur et testé ;
  - `SignValidationDialog.tsx`, `NewValidationDialog.tsx`.
- **Colonnes** : `fieldVisibility` du `.pref` et `SavedViewsMenu`, clé de type `root::<type>` ; réglages : `columns`.
- **`IssueProposalDialog`** : `origin` devient `{ kind: 'run', runId, testId, requirementId? }` ou
  `{ kind: 'decision', ref, requirementId }` ; `issues:add-decision` pour « Lier ».
- **Éditeur de schéma** : `ElementConfigModal` (décisions, `entryFields`), `objectTypeEditor` (défauts, clés conservées),
  `StructureTab` (ajout sur `root`, un seul), `typeRename` verrouillé.
- **Client web** : `SPEC-WEB §11`, liste de `WEB_HIDDEN`.

## Tests

Voir `specs/GH204-tests.md`. E2E dans `e2e-desktop/` : les channels étant masqués sur le web, `e2e-web/` ne peut pas
afficher la vue (même situation que #202).
