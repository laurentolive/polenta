# GH68 — Scénarios de test

Spec : `specs/GH68.md` · Design : `specs/GH68-design.md`.

Données communes : un repo avec un type de test dont le statut d'approbation s'appelle `valide`
(`isApproval: true`, pour vérifier qu'on ne compare pas au littéral `approved`), et les statuts
`draft`, `review`, `valide`, `obsolete` (`isTerminal`). Tests : `TEST-A` (`draft`, 2 étapes),
`TEST-B` (`valide`), `TEST-C` (`obsolete`).

## Unitaires (sprint 1)

### `isApprovalStatus` (packages/types)
- U1 — type avec `valide` en `isApproval` : `valide` → vrai, `approved` → faux, `draft` → faux.
- U2 — type sans statut `isApproval` / type `undefined` : `approved` → vrai, autre → faux.

### `CampaignsService.refreshEntries` (`campaigns.service.refresh.test.ts`)
- R1 — instance `pending`, copie `draft` v1, test live modifié (v2, étape 1 changée) → copie
  remplacée par v2, fichier écrit une fois.
- R2 — instance `pending`, copie `valide`, test live modifié → copie **inchangée**, aucune écriture.
- R3 — instance exécutée (`PASS`), copie `draft`, test live modifié → inchangée.
- R4 — copie `draft`, test live identique → aucune écriture (comparaison profonde).
- R5 — copie `draft`, test live passé `valide` → copie = version `valide` ; un 2ᵉ appel après
  une nouvelle modification du test → inchangée (§12).
- R6 — test source supprimé → copie conservée, pas d'erreur.
- R7 — campagne `completed` / `abandoned` → aucune modification, campagne renvoyée telle quelle.
- R8 — entrée pré-T49 (sans `testSnapshot`) → ignorée.
- R9 — `entryIds` contient un id inconnu → ignoré, pas d'erreur.
- R10 — `resolvedParams`, `paramValues`, `unresolvedParams`, `requirementId`, `carriedFrom`
  d'une instance resynchronisée → inchangés.
- R11 — schéma absent ou type introuvable → repli `approved` (une copie `draft` est resynchronisée).
- R12 — deux `refreshEntries` concurrents sur la même campagne → sérialisés par `enqueue`, fichier
  final cohérent.

### `CampaignExecutionService` / `validateExecutionImport`
- X1 — export d'une campagne avec `TEST-A` pending en copie v1 (`draft`), test live v2 → le
  classeur contient les étapes v2 **et** la campagne est réécrite avec la copie v2.
- X2 — export : instance `TEST-B` (`valide`) pending, test live modifié → classeur = copie
  figée (comportement GH36 inchangé).
- X3 — export d'une campagne clôturée → refus inchangé, aucune écriture.
- X4 — aperçu d'import avec une instance remplie dont la copie est `draft` → `importable`
  la contient, `warnings` contient `{ code: 'test_not_approved', entryId, status: 'draft' }`.
- X5 — même cas avec une copie `valide` → pas de warning.
- X6 — instance non remplie et non approuvée → pas de warning (seules les importables sont signalées).
- X7 — export (v2 figée) puis modification du test (v3) puis import → import accepté, pas de
  `steps_mismatch` lié à v3, copie finale = v2.

## Renderer / e2e (sprint 2)

### Sélection
- S1 — campagne `planned`, « + Ajouter des tests » : `TEST-A`, `TEST-B`, `TEST-C` listés ; colonne
  Statut visible même si les préférences Vue Excel de l'utilisateur ne l'affichent pas ; les
  préférences ne sont pas réécrites (vue système inchangée après fermeture).
- S2 — ajout de `TEST-A` → instance `pending`, badge « Non approuvé » (infobulle « Statut du
  test : Brouillon »), bandeau « 1 instance à exécuter… ».
- S3 — `/campaign/new` : mêmes tests proposés que S1, création OK avec `TEST-C`.
- S4 — report GH64 : entrée `pending` de `TEST-A` dans une campagne source → ligne disponible
  (non grisée), badge « Non approuvé », report OK. Les motifs « Test supprimé » / « Hors
  périmètre » / « Exigence plus liée » / « Déjà présent » restent fonctionnels.
- S5 — campagne sans aucun test proposable → message `noTestCaseAvailable` (plus de message
  « aucun test approuvé »).
- S6 — « Dupliquer » une instance de `TEST-A` paramétré → nouvelle instance créée.

### Liste et badges
- L1 — instance `pending` de `TEST-A`, puis `TEST-A` passé `valide` dans l'éditeur → retour sur
  la campagne : badge et bandeau disparus (statut live, avant même l'ouverture de l'exécution).
- L2 — instance de `TEST-B` (ajoutée `valide`), `TEST-B` repassé `draft` → **pas** de badge (copie
  approuvée, non resynchronisable — T49).
- L3 — instance exécutée sur une copie `draft` → badge (statut figé) ; pas comptée dans le bandeau.

### Exécution
- E1 — ouverture de l'exécution de `TEST-A` après modification de l'étape 1 → étape modifiée
  affichée ; `campaigns/<id>.yaml` contient la nouvelle copie.
- E2 — bandeau d'avertissement affiché ; « Enregistrer le résultat » → confirmation ; Annuler →
  rien n'est écrit (pas de `TestRun`, instance `pending`).
- E3 — confirmation acceptée → `TestRun` créé, instance au statut saisi, copie = version affichée
  en E1 ; modification ultérieure de `TEST-A` puis réouverture → copie inchangée.
- E4 — ré-exécution de la même instance (déjà `FAIL`) → bandeau présent, pas de confirmation.
- E5 — Ctrl+Entrée dans un commentaire sur une instance non approuvée pending → confirmation
  (le raccourci ne la contourne pas).
- E6 — exécution de `TEST-B` (`valide`) → ni bandeau, ni confirmation, aucune écriture à l'ouverture.
- E7 — échec de `refreshEntries` (simulé) → copie existante affichée, message
  `refreshFailed`, exécution possible.
- E8 — passage `planned` → `in_progress` à la première saisie sur une instance non approuvée :
  inchangé.

### Import Excel
- I1 — aperçu d'import d'un classeur avec `TEST-A` rempli → avertissement « TEST-A-1 : test non
  approuvé (draft) » ; import possible.

### Analyse d'impact
- A1 — exigence impactée couverte par `TEST-A` (`draft`) → « Créer une campagne » : `TEST-A`
  présélectionné dans `/campaign/new`.

### Non-régression
- N1 — `carryOver.test.ts`, `campaigns.service.carry.test.ts`, e2e `gh64-carry-over`,
  `gh65-*`, `parity` passent (après mise à jour des attentes `notApproved`).
- N2 — page de relecture d'un run (`run.$testId`) et exports plan/rapport : lisent toujours
  `testSnapshot`, aucune resynchronisation.
- N3 — client web (GH44) : `campaigns:refresh-entries` autorisé pour un rôle pouvant exécuter,
  refusé en lecture seule (comme `campaigns:update-run`).

## Critères d'acceptation vérifiables

Les CA1–CA12 de `specs/GH68.md`, avec CA7 et CA9 lus selon §2 du design : copie figée = version
affichée à l'ouverture de l'exécution, ou exportée dans le classeur.
