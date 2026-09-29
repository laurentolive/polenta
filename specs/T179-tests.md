# T179 — Scénarios de test

Réf. : `specs/T179.md`, `specs/T179-design.md`.

## Fixture

Repo produit avec :
- `SYS-0041` (`title: Autonomie Eco`, `fields.mode: Eco`, `fields.target: 45 min`, `tags: [perf, eco]`, `approved`)
- `SYS-0042` (`mode: Turbo`, `target: "{duree_turbo}"`, `approved`)
- `SYS-0043` (`mode: Normal`, `target: 30 min`, `obsolete`)
- `SYS-0044` (`mode: Boost`, `target: ""`)
- paramètre de base `duree_turbo = 12`, unité `min`
- `TEST-0012` : étape `action: "Mode {req.mode}"`, `expectedResult: "≥ {req.target} ({req.id})"`,
  `postconditions: "SN {numero_serie}"`
- liens : `TEST-0012 → SYS-0041` (verification), `SYS-0042 → TEST-0012` (autre type),
  `TEST-0012 → SYS-0043`
- `TEST-0020` : sans `{req.…}`, lié à `SYS-0041`, `SYS-0042`
- `TEST-0030` : `{req.target}`, sans lien
- tag `baseline/v1` posé quand `SYS-0041.target = 40 min` et sans lien `SYS-0042 ↔ TEST-0012`

## Sprint 1 — service (script)

### Nominal
| # | Scénario | Attendu |
|---|---|---|
| N1 | `previewParams` sans baseline sur `TEST-0012` | `requirements` = [`SYS-0041`, `SYS-0042`] (tri naturel, SYS-0043 exclu obsolète) ; `SYS-0041.resolved` = `{req.mode: Eco, req.target: 45 min, req.id: SYS-0041}` ; `SYS-0042.resolved['req.target']` = `12 min` (paramètre imbriqué) ; `manual` = [`numero_serie`] (aucune clé `req.*`) |
| N2 | `addTests([TEST-0012])` sans `reqInstances`, `paramValuesByTest = {TEST-0012: {numero_serie: A}}` | 2 instances `TEST-0012-1`/`-2`, `requirementId` SYS-0041 / SYS-0042, `paramValues.numero_serie = A` sur chacune, `resolvedParams` avec clés `req.*` |
| N3 | `addTests` avec `reqInstances = {TEST-0012: [{requirementId: SYS-0042, paramValues: {numero_serie: B}}]}` | 1 instance SYS-0042, `numero_serie = B` |
| N4 | Après N3, `addTests([TEST-0012])` sans sélection | ajoute seulement l'instance SYS-0041 ; `testCaseIds` contient 2× TEST-0012 |
| N5 | Après N2, `addTests([TEST-0012])` | aucune instance ajoutée |
| N6 | `addTests([TEST-0020])` | 1 instance sans `requirementId` (critère 5) ; ré-ajout : rien |
| N7 | `addTests([TEST-0030])` | 1 instance sans `requirementId` ; `unresolvedParams = [{ref: req.target, reason: no_linked_requirement}]` ; `manual` sans `req.target` |
| N8 | `create` avec `baselineRef: baseline/v1`, `testCaseIds: [TEST-0012]` | 1 instance (SYS-0041 seul, lien SYS-0042 absent au tag) ; `req.target = 40 min` ; `paramSourceRef = baseline/v1` |
| N9 | `duplicateTest(TEST-0012, {numero_serie: C}, requirementId: SYS-0041)` | nouvelle instance `TEST-0012-3`, `requirementId` SYS-0041, valeurs `req.*` relues |
| N10 | `execute(TEST-0012, {…, requirementId: SYS-0042, result FAIL})` puis `execute(…, SYS-0041, PASS)` | `TestRun.requirementId` écrit ; matrice : cellule (SYS-0042, TEST-0012) = `fail`, (SYS-0041, TEST-0012) = `pass` (critère 12) |
| N11 | Champs système et dérivés : `{req.title}`, `{req.status}`, `{req.version}`, `{req.updatedBy}`, `{req.tags}`, `{req.needsRevalidation}` | `Autonomie Eco`, `approved`, `1`, auteur du dernier commit, `perf, eco`, `false` |
| N12 | Au tag : `{req.updatedAt}` | date du dernier commit du fichier **au tag**, pas à HEAD |

### Cas limites
| # | Scénario | Attendu |
|---|---|---|
| L1 | `{req.inconnu}` | `unresolved` `missing` pour chaque exigence ; jamais dans `manual` |
| L2 | Lien vers `SYS-0044` (`target` vide) | `{req.target}` → `empty` |
| L3 | `baselineRef: inexistant` | liens illisibles → 1 instance sans `requirementId`, chaque clé `req.*` en `tag_not_found` (pas `no_linked_requirement`) ; ajout autorisé, notifié |
| L4 | Lien orphelin (exigence supprimée) | ignoré, pas d'instance |
| L5 | Lien créé dans les deux sens vers la même exigence | 1 seule instance |
| L6 | `{x::req.y}` dans un test | non reconnu, reste littéral, pas dans `unresolved` |
| L7 | `{req.target}` dans une exigence | littéral ; absent de « Utilisé par » ; aucune entrée `unresolved` |
| L8 | Champ personnalisé nommé `status` | `{req.status}` renvoie le statut système |
| L9 | Run exécuté avant T179 (sans `requirementId`) plus récent qu'un run d'instance | compte pour toutes les exigences liées (règle actuelle) |
| L10 | `reqInstances` citant une exigence non liée | ignorée |
| L11 | Campagne existante (T171) relue | identique, aucune réécriture ; `manualKeysForRun` inchangé pour elle |

## Sprint 2 — UI (manuel dans l'app)

| # | Scénario | Attendu |
|---|---|---|
| U1 | Panneau d'ajout, cocher `TEST-0012` | liste SYS-0041/SYS-0042 cochées, valeurs `req.*` en lecture seule, champ `numero_serie` par exigence ; bouton désactivé tant qu'une saisie manque |
| U2 | Décocher les deux exigences | le test n'est pas ajouté ; bouton selon les autres tests |
| U3 | Rouvrir le panneau après ajout partiel | `TEST-0012` proposé, SYS-0041 grisée « déjà présente » |
| U4 | Liste de campagne | `TEST-0012 — … · SYS-0041` ; clic sur l'ID ouvre l'exigence |
| U5 | Page d'exécution d'une instance | bandeau « Exigence : SYS-0042 — … » ; « ≥ 12 min (SYS-0042) » avec style valeur figée ; survol `req.target` |
| U6 | Instance de `TEST-0030` | bandeau des non résolues avec libellé « aucune exigence liée » |
| U7 | Fiche `TEST-0012` | `{req.target}` stylé `param-ref--req` ; survol : `SYS-0041 : 45 min`, `SYS-0042 : 12 min` |
| U8 | Vue Word des tests / recherche | style dédié, titre générique au survol |
| U9 | Exigence contenant `{req.x}` | texte brut, sans style |
| U10 | Éditeur de test : `{` puis section « Champ de l'exigence liée » | insère `{req.<champ>}` |
| U11 | Exports plan/rapport (docx, xlsx, pdf) | une ligne par instance avec l'ID d'exigence, valeurs figées |
| U12 | Campagne T171 existante, test sans `{req}` | affichage et exports inchangés (critère 16) |
| U13 | Thème sombre | style `param-ref--req` lisible |

## Critères d'acceptation (renvoi)

Critères 1–16 de `specs/T179.md` : N1–N12 et L1–L11 couvrent 1–13 ; U1–U13 couvrent 4, 6, 14, 15, 16
côté écran.
