# GH340 — Sprint 1 : écriture, lecture, fusion, docs

Spec : `specs/GH340.md` · design : `specs/GH340-design.md` · scénarios : `specs/GH340-tests.md`.

## Fichiers modifiés

**Main (`apps/desktop/src/main/services/`)**
- `audit-fields.util.ts` : réécrit. Il contient :
  - `contentChanged`, `applyAudit`, `auditForWrite` ;
  - `readAuditFields` / `withAuditFields`, `withoutAuditFields`.

  `omitAuditFields` (T112) est supprimé.
- `history.service.ts` :
  - `stampObject`, qui pose historique et dates avec une seule horloge et un seul acteur ;
  - repli des trous d'historique sur le dernier commit du fichier, dans `readEffectiveHistory`.
- `requirements.service.ts`, `tests.service.ts`, `issues.service.ts`, `revalidation.service.ts` :
  `stampObject` et `auditForWrite` au point d'écriture unique. Le `rewriteObjects` des issues écrit
  les dates telles quelles.
- `requirements-index.service.ts`, `tests-index.service.ts`, `issues.service.ts` (`getOrBuild`),
  `req-refs.service.ts` (`readAtTag`) : dates lues dans le YAML, plus aucun parcours git.
- `git.service.ts` : `fileHistoryMap` est supprimé (plus d'appelant).
- `campaign-snapshot.util.ts` :
  - `snapshotOf` : copie sans historique ni dates ;
  - `testFingerprint` passe par le `canonical` de merge-core (même chaîne).
- `campaigns.service.ts` : les copies `testSnapshot` passent par `snapshotOf`.
- `graph.service.ts` : `gapFallbacks` (dernier commit, seulement pour les objets à trou
  d'historique). Les dates de l'objet viennent du YAML.
- `agents-md.template.ts` : les dates sont posées par l'application, jamais à la main.

**`packages/merge-core`**
- `structure.ts` :
  - crochet `StructureDesc.decide(path, roots)`, évalué avant les cas triviaux ;
  - `OBJECT_DESC.decide` : chaque paire (date, auteur) vient d'un seul côté, la plus récente pour la
    modification, la plus ancienne pour la création.
- `merge-tree.ts` : `MergeContext` conserve les deux racines et appelle `decide`.
- `index.ts` : `canonical` exporté.

**Tests**
- Nouveau : `audit-fields.gh340.test.ts` (W1–W10, W3b, W12, R1–R3, R5, utilitaire).
- `merge-core.test.ts` : F1, F1b, F2, F3.
- Adaptés :
  - `history.writes.test.ts` : l'acteur n'est résolu que si l'écriture change quelque chose ; W11
    MCP couvre aussi les dates ;
  - `issues.gh244.test.ts` : I1 attend les dates dans le fichier ;
  - `index-builds.gh87.test.ts` et `requirements-index.race.test.ts` : la porte passe sur le listage
    ou la lecture, puisque les constructions ne lisent plus l'historique ;
  - `history.write-paths.test.ts` : les issues sont couvertes, plus `issues#persist` et
    `issues#rewriteObjects`.

**Docs** : `CLAUDE.md`, `specs/T112.md` (renvoi), SPEC (voir plus bas).

## Comportement

- **Création** (exigence, test, issue ; UI, client web, MCP) : les quatre dates sont écrites.
- **Modification** : la date avance seulement si le contenu hors clés de l'application change. Une
  revalidation, un renommage, un déplacement ou une reprise d'historique laissent les dates
  inchangées. Une sauvegarde sans changement laisse le fichier identique à l'octet près.
- **Valeurs inconnues** : jamais écrites. Un objet non repris que l'on modifie reçoit
  `updatedAt` / `updatedBy` seuls.
- **Fusion** : ces champs ne produisent jamais de conflit, et un auteur suit toujours sa date.
- **Index et lecture à un tag** : plus aucun accès à git pour ces champs.

## Mesure (R6)

Reconstruction des trois index de handstickProduct (copie locale, 451 fichiers, 34 commits),
médiane de 3 :

| | Avant | Après |
|---|---|---|
| Exigences + tests + issues | **758 ms** | **71 ms** |

Ce temps ne dépend plus du nombre de commits : avant, il croissait avec l'historique (451 s pour
786 commits sans filtre de dossier, mesuré pour #337).

## Divergences avec le design (corrigées dans `GH340-design.md`)

Après `/code-review` :
- **`stampObject` remplace un `stampAudit` séparé** : historique et `updatedAt` avaient deux
  horloges et deux résolutions d'acteur.
- **Repli des trous d'historique** : le dernier commit du fichier, et non `updatedAt`, qu'une
  édition hors de l'application n'avance pas. S'applique aussi au graphe et à `history:get`.
- **`decide` plutôt qu'un 5ᵉ argument de `reconcile`** : les cas triviaux passent avant `reconcile`
  et pouvaient casser la paire (date, auteur).
- **`canonical` de merge-core réutilisé**, pas de copie.
- **`APP_KEYS` propre aux dates** : `version-tracking` garde sa liste, de sens différent.

Points de la revue non retenus :
- Les dates figurent dans la liste « fusionné automatiquement » d'une fusion, comme `version` et
  `history`. La spec parlait de conflits.

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` :
  - §3.4 : champs système `createdAt` … `updatedBy` (stockés, posés par l'application, règle du
    contenu) ;
  - §4.4 : l'entrée « déduite » reste datée du dernier commit du fichier, lu seulement en cas de
    trou, et jamais de `updatedAt`.
- `SPEC-TESTS.md` :
  - §2.4a : `{req.<champ>}`, « dates de l'objet » ;
  - §4.x (empreinte GH81) : idem.
- `SPEC-TECH-stack.md` §6.6 : règle de fusion des dates.
- `SPEC-INDEX.md` : colonne MAJ mise à jour au dernier sprint.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm lint` : OK.
- `pnpm test` : OK (desktop 1 744, merge-core 83, admin-service 124).
- e2e voisins (GH77, GH222 diff-edit et tree-merge) : 17 passés (`pnpm build:web` puis
  `npx playwright test e2e-web/gh77-history e2e-web/gh222-diff-edit e2e-web/gh222-tree-merge`).

## Tester à la main

1. Créer une exigence, puis ouvrir son fichier YAML : `createdAt`, `createdBy`, `updatedAt` et
   `updatedBy` sont présents.
2. La modifier : `updatedAt` avance. Rouvrir et enregistrer sans rien changer : aucune modification
   dans le panneau Version.
3. Ouvrir un objet d'un dépôt existant : « — » pour Créé le / Modifié le, jusqu'à la reprise
   (sprint 2).
