# GH200 — Sprint 3 : trace départ / approbation, hors interface, graphe (sprint final)

## Fichiers modifiés

- `main/services/change-tracking.service.ts` : `trace` (base, commit d'approbation, état
  `modified`, en attente), `outsideModifications` ; historique des fichiers d'éléments lu une fois
  par HEAD (`commitChanges`, premiers parents), contenu d'un commit mis en cache (immuable), contenu
  comparé sur les champs de contenu (JSON à clés triées).
- `main/services/changes.service.ts` : `setTracker`, `trace`, gel de `approved` / `state` à
  l'entrée dans un statut terminal (retrait à la sortie), éléments `outside` ajoutés au backlog.
- `main/services/sync.service.ts` : `diffElement` (départ → commit, ou disque ; création = gauche vide).
- IPC `changesets:trace`, `sync:diff-element` ; politique du serveur web ; api-client.
- Renderer : colonnes Départ / Approbation + « Voir les modifications » (`ChangeElements`,
  `changeset.$changeId`) ; route `/diff` : `element`, `baseSha`, `toSha` (facultatifs) ; backlog :
  « modifié hors interface », diff, « Rouvrir et assigner… » (porte de modification).
- Graphe : `GraphChangeset.toModify[].base / approved` ; `polenta.d.ts` régénéré, manifeste v8.
- MCP : `get_changeset` renvoie `trace`.
- i18n fr / en : `changes.trace.*`, `changes.backlog.outside`, `changes.backlog.reopen`.

## Divergences avec le design

- Graphe : `approved` est la valeur **figée** (changeset terminal), `null` tant que le changeset
  est ouvert ; le design prévoyait le calcul pour un changeset ouvert. Le graphe reste une lecture
  de fichiers (pas d'historique git dans sa construction) ; le statut courant de l'élément est dans
  sa collection. SPEC-DASHBOARDS l'indique.
- Base sans SHA (élément approuvé jamais publié) : le diff part de « vide » comme une création.

## Mises à jour SPEC

- `SPEC-REQ-requirements.md §10` : rattachement par élément (verrou, assignation, trace, hors
  interface, limite des renommages).
- `SPEC-TEMPLATES.md §1–4` : préférence `changeTracking`.
- `SPEC-MCP-SERVER.md §4` : `changesetId`, `unassigned`, réouverture avant contenu, `trace`.
- `SPEC-DASHBOARDS.md §1–§3` : `toModify[].base / approved`, manifeste v8.
- `SPEC-INDEX.md` : colonne MAJ → GH200 pour ces sections.

## Corrections en fin de sprint

- Commit d'approbation : une réouverture et une réapprobation publiées dans **un seul** commit
  (approuvé → approuvé) n'étaient pas reconnues ; une version plus récente que celle de la base
  vaut nouvelle approbation (U13bis, A8).
- Trace d'un changeset terminal : lue dans le fichier, plus recalculée (le gel calcule sur le
  changeset encore ouvert).
- Porte de modification : valeur du provider mémorisée (callbacks des vues stables).
- E2E existants adaptés au verrou de l'approuvé : `gh145-statement-diff` et `parity` (P-4) rouvrent
  l'exigence approuvée avant de la modifier ; `gh152-richtext-undo` ouvre un brouillon créé pour le
  test.

## Tests

- Unitaires `change-tracking.gh200.test.ts` : U13 (approbation = commit de réapprobation, pas
  celui du flag), U14 (deux cycles), U15 (en attente), U16 (gel / retrait), U17–U18 (hors interface,
  flag seul ignoré, backlog).
- E2E `e2e-web/gh200-trace.spec.ts` : A8 (départ v1 / approbation v2, diff), A9 (gel), A13
  (backlog « modifié hors interface »).

## Comment tester manuellement

1. Un changeset ouvert ; une exigence approuvée publiée.
2. La rouvrir, modifier le titre, la réapprouver, Publier : page du changeset → « v1 · … → v2 · … »,
   « Voir les modifications » ouvre le diff.
3. Clore le changeset : l'approbation reste affichée (figée dans le fichier).
4. Modifier le titre d'une exigence approuvée dans un éditeur de texte : Backlog → « modifié hors
   interface », diff, « Rouvrir et assigner… ».
