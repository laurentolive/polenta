# GH199 — Sprint 4 : backlog et assignation des éléments (avenant §8bis)

## Fichiers modifiés

- Types (`packages/types/src/change.ts`) : `ChangeSummary.open` / `toModifyIds`, `BacklogItem`,
  `ComponentBacklog`, `ApprovalCheck`, `isToProcess`.
- Main : `ChangesService.backlog` (calculé par composant local, rien n'est écrit), `assign`, `move`,
  `approvalCheck` ; helpers `localNodes`, `componentOfRef`, `isTerminalStatus`. IPC / web :
  `changes:backlog`, `changes:assign`, `changes:move` (écriture), `changes:approval-check` ;
  api-client.
- Renderer :
  - `AssignToChangeDialog` : changes ouverts, nouveau change, « Approuver sans change ».
  - `ApprovalGateContext` (provider dans `AppLayout`) : branché sur `SystemView` (édition,
    tableau, document), `SearchEditPane`, `req.$reqId`, `test.$testId`.
  - `useBacklog`, entrées « Backlog (N) » du panneau Changements, route `/changes/backlog`.
  - `ToModifyList` : cases, « Déplacer vers… », « aussi dans … ». `ImpactedList` : badge
    « à traiter », « Passer en à modifier ».
  - `useLiveFileSync` : invalidation de `changes-backlog`. i18n fr / en.
- Tests : `changes-backlog.gh199.test.ts` (8) ; e2e `gh199-backlog.spec.ts` (B1/B2, B3, B5, B6).

## Divergences

- Les entrées du panneau sont identifiées par repo **et** composant (`changes-backlog-entry-<repo>-<nœud>`) :
  chaque repo de composant a son propre nœud `root`.
- Revue de code, corrigé :
  - `move` : un élément déjà dans la cible garde « modifié » ; un élément absent de la source ne
    touche pas la cible ; source close refusée avant toute écriture.
  - Dialogue : non annulable pendant une écriture en cours.
  - Approbations simultanées mises en file (plus d'annulation silencieuse de la première).
  - `approvalCheck` lit le seul fichier de l'élément ; `resolveComponent` réutilise `localNodes`.
- Non retenu :
  - L'assignation reste « change ouvert du **même repo** » (spec §8bis), sans filtrer par
    composant.
  - L'invalidation du backlog à chaque écriture d'élément ne coûte que si le panneau Changements
    est affiché.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| SPEC-REQ §10 | backlog, assignation, déplacement, dialogue d'approbation |
| SPEC-REQ §4.3 | exception d'interface à « toutes les transitions sont autorisées » |
| SPEC-TRACEABILITY §4.3 | élément à traiter atteint : badge, « Passer en à modifier » |
| GH193 §7.2 | condition `assignedToChange` (par défaut, avec #206) |

## Comment tester manuellement

`specs/GH199-tests.md` scénario 21 :
- « Nouveau change » depuis le dialogue (approbation, backlog) ;
- repo à plusieurs composants : un backlog par composant ;
- approbation depuis la vue tableau / document.
