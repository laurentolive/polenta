# GH200 — Scénarios de test

Spec : `specs/GH200.md` ; design : `specs/GH200-design.md`.

## Unitaires (main)

| # | Scénario | Attendu |
|---|---|---|
| U1 | `isOn` : pas de type changeset / type présent sans préférence / `off` / `on` | off / on / off / on |
| U2 | `update` titre d'une exigence approuvée | `ApprovedLockedError` ; fichier inchangé |
| U3 | `update` statut `draft` + titre sur une approuvée | accepté (réouverture), version + 1 |
| U4 | `update` sur un brouillon | accepté |
| U5 | `create` avec un seul changeset ouvert | élément dans `toModify` (`planned`, sans `base`) ; `assignedTo` renvoyé |
| U6 | `create` avec deux changesets ouverts, sans `changesetId` | non assigné ; avec `changesetId` : assigné à celui-là |
| U7 | `openDraft` d'une approuvée commitée | `base = { sha: dernier commit du fichier, version: avant }` |
| U8 | `openDraft` alors que l'élément est dans `toModify` d'un changeset ouvert sans `base` | pas de nouvelle assignation, `base` complétée |
| U9 | `openDraft` alors que son seul changeset est clos | nouvelle assignation |
| U10 | transition approuvé → obsolète (`isTerminal`) | assignation (`terminal`) |
| U11 | règle `off` | aucune assignation |
| U12 | test (`TestsService`) : U2, U5, U7 | mêmes résultats |
| U13 | `trace` : réouverture, commit, réapprobation, commit, `needsRevalidation` levé, commit | `approved` = commit de réapprobation (pas celui du flag) |
| U14 | `trace` : deux cycles rouvrir / approuver | départ = premier, approbation = dernière |
| U15 | `trace` : approuvé sur disque non publié | `approvalPending` |
| U16 | gel : changeset → `clos` | `approved` et `state` écrits ; rouvert → `approved` retiré |
| U17 | `outsideModifications` : titre d'une approuvée modifié par commit direct | listée ; diff disque non commité → `dirty` |
| U18 | `outsideModifications` : seul `needsRevalidation` change | non listée |
| U19 | MCP `bulk_import_requirements` sans `changesetId`, deux ouverts | créés, `unassigned` = leurs IDs |
| U20 | MCP `update_requirements` titre d'une approuvée | erreur explicite |

## E2E (client web, `e2e-web/gh200-*.spec.ts`)

| # | Spec | Scénario |
|---|---|---|
| A1 | `gh200-lock` | vue Excel : cellules d'une approuvée non éditables, colonne Statut éditable |
| A3 | `gh200-assign` | rouvrir (vue Word) avec un seul changeset → toast, élément dans `toModify` |
| A4 | `gh200-assign` | deux changesets → dialogue ; Annuler → toujours approuvée |
| A5 | `gh200-assign` | créer une exigence sans changeset ouvert → formulaire, puis élément dans le nouveau changeset |
| A6 | `gh200-assign` | rouvrir un élément déjà assigné → aucune question |
| A7 | `gh200-assign` | seul changeset clos → dialogue de création |
| A10 | `gh200-assign` | approuvé → obsolète → assignation |
| A11 | `gh200-assign` | création en masse : un seul dialogue |
| A14 | `gh200-assign` | préférence décochée → création sans question, verrou maintenu |
| A8 | `gh200-trace` | modifier, publier, réapprouver, publier → Départ v3 / Approbation v4, « Voir les modifications » ouvre le diff |
| A9 | `gh200-trace` | clore le changeset → approbation figée dans le fichier |
| A13 | `gh200-trace` | commit direct (fixture) sur une approuvée → backlog « modifié hors interface » |

## Manuel

- Vue Word, éditeur de test (étapes) : verrou et réouverture visuellement cohérents.
- Diff d'un élément créé (face à vide) et d'un élément non encore approuvé (face au disque).
- Application desktop : MCP réel, `changesetId` et refus sur approuvé.
