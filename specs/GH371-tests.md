# GH371 — Scénarios de test

Fichier automatique : `apps/desktop/src/main/services/schema-mutation.gh371.test.ts` (conteneur MCP réel sur un
dossier temporaire, handlers appelés comme le SDK). Repo de test : type exigence `exigence` (statuts `draft`,
`review`, `approved` isApproval ; champ `justif` avec `requiredWhen: { status: [review] }` ; transition
`draft → review`), type test `test`, campagne `campagne`, type version `version`, type validation `validation`
(statuts `en_cours`, `signee` isApproval, `annulee` isTerminal ; décisions `en_attente` isPending, `conforme`,
`non_conforme` ; entryField `motif` `requiredWhen: { decision: [non_conforme] }`), composant `lecture` readonly.

Colonne « Auto » : `oui` = couvert par le test automatique ; `manuel` = à tester à la main.

## A. `add_field` — `entryFields` (CA 1)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| A1 | `list: entryFields`, champ `commentaire_qualite` sur `validation` | ajouté en fin de `entryFields` sur disque | oui |
| A2 | même appel sur `exigence` | `[VALIDATION_TYPE_INVALID]`, schéma inchangé octet pour octet | oui |
| A3 | nom `decision` ; nom `motif` (déjà présent) | `[FIELD_NAME_TAKEN]` | oui |
| A4 | `requiredWhen: { decision: [inconnue] }` ; `{ autre: [x] }` (champ absent) | `[REQUIRED_WHEN_INVALID]` | oui |
| A5 | `requiredWhen: { decision: [conforme] }` | accepté | oui |
| A6 | `list` absent / `fields` / `runFields` | comportement antérieur (tests existants) | oui |

## B. Décisions (CA 2–5)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| B1 | `add_decision { name: reserve, proposesIssue: true }` | ajoutée en fin | oui |
| B2 | `add_decision { isPending: true }` ; nom existant | `[VALIDATION_TYPE_INVALID]` ; `[DECISION_NAME_TAKEN]` | oui |
| B3 | `update_decision { name: conforme, isPending: true }`, non utilisée | seule `conforme` porte `isPending` | oui |
| B4 | idem, `conforme` portée par une entrée (proposée) | `[DECISION_IN_USE]`, ID de la validation cité | oui |
| B5 | `update_decision { to }` sur décision portée par une validation signée | `[DECISION_IN_USE]`, ID cité, aucun fichier modifié | oui |
| B6 | `update_decision { name: non_conforme, to: refus }`, non utilisée | schéma renommé, `motif.requiredWhen.decision = [refus]`, validations intactes | oui |
| B7 | `to` déjà pris ; `name` inconnu | `[DECISION_NAME_TAKEN]` ; `[DECISION_NOT_FOUND]` | oui |
| B8 | `label: null`, `color: null`, `proposesIssue: false` | clés retirées du YAML | oui |
| B9 | aucune propriété ; `isPending: false` | erreur d'entrée (`Input validation error`) | oui |
| B10 | `remove_decision` portée par une entrée ; en attente ; citée par `motif` ; libre | `[DECISION_IN_USE]` (ID) ; `[VALIDATION_TYPE_INVALID]` ; `[REQUIRED_WHEN_INVALID]` ; retirée | oui |
| B11 | décisions sur `exigence` | `[VALIDATION_TYPE_INVALID]` | oui |

## C. Statuts — `update_status` (CA 6–8)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| C1 | `update_status { name: review, to: relecture, dryRun }`, 2 exigences en `review` | `withOld = 2`, aucun fichier modifié | oui |
| C2 | même appel réel | `status` et `history.status` des 2 exigences migrés ; transition `draft → relecture` ; `justif.requiredWhen.status = [relecture]` ; `migration.migrated` = 2 IDs | oui |
| C3 | renommage d'un statut de type test porté par une copie `testSnapshot` de campagne | copie migrée (`migration.snapshots = 1`) | oui |
| C4 | `to` existant | `[STATUS_NAME_TAKEN]` | oui |
| C5 | `label`, `color`, `isApproval`, `isTerminal` ; puis `null` / `false` | clés posées puis retirées, objets inchangés, `migration` vide | oui |
| C6 | type validation avec une validation : renommer `signee`, `isApproval: false` sur `signee` | `[VALIDATION_TYPE_INVALID]` | oui |
| C7 | type version avec une version : renommer le statut released | `[VERSION_TYPE_INVALID]` | oui |
| C8 | type validation sans validation : `isApproval: true` sur `en_cours` | `[VALIDATION_TYPE_INVALID]` (deux signées / premier statut marqué) | oui |
| C9 | statut inconnu ; type `campagne` | `[STATUS_NOT_FOUND]` ; `[STATUS_LIST_INVALID]` | oui |

## D. Statuts — `remove_status` (CA 9)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| D1 | `remove_status review` porté, sans `replaceWith` | `[STATUS_IN_USE]`, nombre et IDs | oui |
| D2 | `remove_status review, replaceWith: approved, dryRun` | `withOld = 2`, `withNew` = nb en `approved`, rien d'écrit | oui |
| D3 | même appel réel | objets en `approved` (statut et `history.status`), `review` retiré, transition `draft → approved`, `justif.requiredWhen.status = [approved]` | oui |
| D3b | `remove_status review, replaceWith: draft` | la règle `draft → review` deviendrait `draft → draft` : `[TRANSITION_INVALID]`, rien d'écrit | oui |
| D4 | statut non porté, cité par une transition / un `requiredWhen`, sans `replaceWith` | `[TRANSITION_INVALID]` / `[REQUIRED_WHEN_INVALID]` | oui |
| D5 | statut non porté, non cité | retiré | oui |
| D6 | `replaceWith` inconnu ; `replaceWith = name` ; dernier statut | `[STATUS_NOT_FOUND]` ; `[STATUS_LIST_INVALID]` ; `[STATUS_LIST_INVALID]` | oui |
| D7 | `signee` du type validation avec une validation | `[VALIDATION_TYPE_INVALID]` (ou `[STATUS_IN_USE]` si portée sans `replaceWith`) | oui |
| D8 | objet créé « par l'application » (fichier écrit hors MCP) après un premier appel | compté par `STATUS_IN_USE` (index rafraîchi) | oui |

## E. `reorder_statuses` (CA 10)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| E1 | `[approved, draft, review]` sur `exigence` | ordre écrit | oui |
| E2 | permutation incomplète / doublon / inconnu | `[STATUS_LIST_INVALID]` | oui |
| E3 | `signee` en tête sur `validation` | `[VALIDATION_TYPE_INVALID]` | oui |

## F. `update_object_type` (CA 11)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| F1 | `displayIdField: title` ; champ `text` ; `null` | accepté ; accepté ; clé retirée | oui |
| F2 | `displayIdField` richtext ou inconnu | `[DISPLAY_ID_FIELD_INVALID]` | oui |
| F3 | `trackStatusHistory: false` sur `validation` | `[VALIDATION_TYPE_INVALID]` | oui |
| F4 | `trackStatusHistory: false` puis `true` sur `exigence` | `false` écrit puis clé retirée ; historique existant intact | oui |
| F5 | `label` / `color` puis `null` | posés puis retirés | oui |

## G. Communs (CA 12–14)

| # | Scénario | Attendu | Auto |
|---|---|---|---|
| G1 | chaque nouvel outil sur le nœud `lecture` | `[NODE_READONLY]` | oui |
| G2 | nœud / type inconnus | `[NODE_NOT_FOUND]` / `[TYPE_NOT_FOUND]` | oui |
| G3 | tout refus | schéma et objets inchangés octet pour octet | oui (échantillon) |
| G4 | dix appels pipelinés sans attente (`add_decision` ×5, `update_status` label, `reorder_statuses`…) | même schéma que séquentiellement | oui |
| G5 | tests MCP existants (`field-rename.service.test.ts`, GH195, GH196, GH229, GH362) | verts | oui |

## H. Manuel (client MCP réel)

| # | Scénario |
|---|---|
| H1 | Depuis un agent (Claude Code + `.mcp.json`), configurer la validation `WASHER_VAL` d'un projet existant : `add_field entryFields`, `add_decision`, `update_status` label, `reorder_statuses` ; ouvrir le projet dans l'application : l'éditeur de type affiche les décisions, champs d'entrée et statuts tels qu'écrits, sans avertissement. |
| H2 | Renommer un statut par `update_status { to }` pendant que l'application est ouverte sur le projet : après rafraîchissement, les exigences affichent le nouveau statut et leur historique le nouveau nom. |
| H3 | `tools/list` du serveur MCP : les 7 nouveaux outils apparaissent avec leurs descriptions ; `AGENTS.md` régénéré les liste. |
