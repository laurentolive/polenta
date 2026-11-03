# GH244 — Design

Spec : `specs/GH244.md`. Trois sprints : 1 main et MCP, 2 interface, 3 proposition de création et SPEC.

## Décisions

- **D1 — Même forme qu'une exigence.** `Issue` (`packages/types/src/issue.ts`) a les champs système d'une
  exigence plus `origin`, sans `needsRevalidation`. Les vues génériques (`SystemView`, `ExcelView`, `WordView`,
  `EditView`) travaillent déjà sur `fields`, `status`, `title` : elles reçoivent une troisième branche, pas
  un nouvel écran. Rejeté : un écran dédié (le contraire de Q3).
- **D2 — `IssuesService` avec son index.** `issues.service.ts`, même structure que `TestsIndexService` et
  `RequirementsService` (index par repo, audit par `fileHistoryMap`, `withKeyLock`, `HistoryService.stamp`,
  `applyFieldsWrite`). Pas de `assertContentEditable` ni de `versionBump` : pas de verrou.
- **D3 — `issue-impact` posé par `SchemaService.save`.** Quand le schéma sauvé déclare un type issue et que
  le précédent n'en déclarait pas, le type de lien est ajouté s'il manque (`sourceRefs: [issue]`,
  `targetRefs: [requirement]`). Tous les chemins sont couverts (éditeur, MCP) ; un retrait ultérieur par
  l'utilisateur n'est pas annulé. Constante `ISSUE_IMPACT_LINK` : c'est par ce nom que l'analyse lit les
  impacts.
- **D4 — Contrôle du composant dans `WorkspaceLinksService.plan`.** Lien entre une issue et une exigence :
  même repo et type déclaré par son schéma, sinon erreur `NOT_OWN_ELEMENT`. Vaut pour l'interface et le MCP.
- **D5 — Versions.** `ELEMENT_DIRS` reçoit `issues` : backlog, inclusion, page et diff suivent. Pas de
  détection « modifié hors interface » sur une issue (pas de verrou). Dans `liveAnalysis`, une ligne de type
  issue n'est pas une racine : ses exigences `issue-impact` le sont, avec `viaIssues` sur
  `VersionImpactRoot`, affiché sur la racine. Les arbres ignorent déjà les ID ni exigence ni test.
- **D6 — Proposition de création dans une popup avec formulaire.** `IssueProposalDialog` écrit tout à la
  validation (`issues.create` puis liens). Réutilisée par le bilan d'import Excel. Rejeté : naviguer vers une
  fiche pré-remplie, car la création de `SystemView` écrit le fichier tout de suite.
- **D7 — « Lier à une issue existante ».** `issues:add-run` ajoute l'exécution à `origin.runs` sous verrou ;
  les exigences manquantes passent par `createLink`.
- **D8 — Libellé.** `validated` garde sa valeur technique et s'affiche « Vérifié ».

## Fichiers

**Sprint 1.** `packages/types` (`issue.ts`, `schema.ts`, `graph.ts`, `product-version.ts`) ;
`packages/zod-schemas` (`issue.schema.ts`) ; main : `issues.service.ts`, `container.ts`, `ipc/index.ts`,
`web-server/channel-policy.ts`, `repo-watcher.service.ts`, `schema.service.ts`, `schema-refs.util.ts`,
`type-rename.service.ts`, `schema-delete.service.ts`, `workspace-links.service.ts`, `link-validation.util.ts`,
`version-tracking.service.ts`, `versions.service.ts`, `version-analysis.util.ts`, `graph.service.ts` ;
MCP : `tools/issues.tools.ts`, `container.ts`, `index.ts`, gabarit AGENTS ; `packages/api-client` ;
`dashboard-lib` (`polenta.d.ts`, manifeste).

**Sprint 2.** `AppLayout`, `ActivityBar`, `Sidebar`, `SystemPanel`, `SystemViewContext`, `SystemView`,
`EditView`, `useSystemObjects`, `FieldConfigModal`, `NoTypeForCategory`, éditeur de schéma (`StructureTab`,
`objectTypeEditor`, `ElementConfigModal`, `LinkTypeEditor`), `useLiveFileSync`, `ElementNavContext`,
`ElementPreviewPopup`, `VersionChangesTable`, `VersionElementPicker`, `VersionAnalysisSection`, backlog, i18n.

**Sprint 3.** `IssueProposalDialog`, écran d'exécution, `ExecutionImportModal`, SPEC.
