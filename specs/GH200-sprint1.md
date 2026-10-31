# GH200 — Sprint 1 : main (verrou, assignation, MCP)

## Fichiers modifiés

- `packages/types/src/change.ts` : `ChangeElementRef`, `ChangeToModify.base` / `approved`,
  `ChangeToModifyTrace`, `OutsideModification`, `ModificationKind`, `ModificationCheck`,
  `BacklogItem.outside`.
- `packages/types/src/schema.ts` : `ProjectPreferences.changeTracking`.
- `packages/zod-schemas` : `changesetId` facultatif sur création (exigence, test), transition
  d'exigence, mise à jour de test.
- `main/services/change-tracking.service.ts` (nouveau) : `ChangeTrackingService` (`isOn`, `check`,
  `assertChangeset`, `onModified`, `base`), `trackingOn`.
- `main/services/approved-lock.util.ts` (nouveau) : `ApprovedLockedError`,
  `assertContentEditable`, `statusModificationKind`.
- `main/services/requirements.service.ts`, `tests.service.ts` : verrou du contenu approuvé,
  `setModificationTracker`, assignation après création / réouverture / passage terminal.
- `main/services/changes.service.ts` : `repoSummaries`, `componentOf`, `attach` ; `toModify` garde
  `base` / `approved` (nettoyage, mise à jour par un client, déplacement).
- `main/services/git.service.ts` : `fileCommits` (chaîne des premiers parents, un fichier).
- Câblage : `main/container.ts`, `mcp-server/container.ts`, IPC `changesets:modification-check`,
  `changesetId` sur `*:open-draft`, `web-server/channel-policy.ts`, api-client.
- MCP : `bulk_import_requirements` / `bulk_import_tests` → `unassigned` ; `update_requirements` /
  `update_tests` → `changesetId`, réouverture écrite avant le contenu, `unassigned`.

## Comportement

Conforme à `specs/GH200.md` §1–§3 côté main. Une création / réouverture sans changeset avec
plusieurs changesets ouverts est écrite sans assignation (backlog) ; c'est la porte du renderer
(sprint 2) qui obtient le choix de l'utilisateur.

## Divergences avec le design

- Le retour `assignedTo` des écritures (design §3.2) n'est pas ajouté : le toast d'assignation
  automatique sera affiché par la porte à partir de `modificationCheck` (un seul éligible).
- `fileCommits` remplace `lastCommitTouching` (même lecture, réutilisable par la trace du sprint 3).
- Lint : le dépôt n'a pas de configuration ESLint (v9) ; contrôle par typecheck.

## Tests

`change-tracking.gh200.test.ts` (U1–U12 + trace conservée), `mcp-tracking.gh200.test.ts` (U19,
U20, `changesetId`, réouverture + contenu). Suites main / MCP / web-server : 79 fichiers verts.
